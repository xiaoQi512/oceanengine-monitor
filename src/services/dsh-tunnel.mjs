// dsh-tunnel.mjs — DSH web 独立远程隧道（Cloudflare quick tunnel + 密码认证代理）
// 复用 dashboard-tunnel 的网关架构：认证代理(默认 8897) -> DSH web(127.0.0.1:3080)
// 与 dashboard-tunnel 的区别：
//   1. 支持 WebSocket upgrade 转发（DSH 前端依赖 WS）
//   2. 登录成功后跳到 DSH 根路径
// 环境变量：DSH_TUNNEL_PORT(代理端口) / DSH_TUNNEL_UPSTREAM / DASHBOARD_TUNNEL_PASSWORD
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildAuthCookie,
  hashPassword,
  isDashboardAuthorized,
} from './dashboard-tunnel-auth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATE_FILE = path.join(ROOT, 'monitor-data', 'dsh-tunnel.json');
const DEFAULT_SETTINGS_FILE = 'C:/Users/HTF2026/.codebuddy/settings.json';
const DEFAULT_PROXY_PORT = 8897;
const DEFAULT_UPSTREAM = 'http://127.0.0.1:3080';
const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
// DSH 对 /api 请求做 DNS rebinding / CSRF 防护（dsh-client-connection 的
// isTrustedApiRequest）：带 Origin 头时必须 Origin.host === Host.host，否则 403。
// 隧道场景浏览器 Origin 是 trycloudflare 域，与代理改写后的 Host(127.0.0.1:3080)
// 不一致 → listDirectory / WS 握手等全部 403。把入站 Origin/Referer 改写为本机
// 地址即可通过校验；本机直连（无 Origin 或同源）不受影响。
const REWRITE_ORIGIN = DEFAULT_UPSTREAM;

function rewriteBrowserHeaders(headers) {
  const out = { ...headers };
  if (typeof out.origin === 'string') out.origin = REWRITE_ORIGIN;
  if (typeof out.referer === 'string') out.referer = `${REWRITE_ORIGIN}/`;
  return out;
}

function readPassword() {
  if (process.env.DASHBOARD_TUNNEL_PASSWORD) return process.env.DASHBOARD_TUNNEL_PASSWORD;
  const settingsFile = process.env.CODEBUDDY_SETTINGS_PATH || DEFAULT_SETTINGS_FILE;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    return settings?.gateway?.password || '';
  } catch (err) {
    console.error(`[dsh-tunnel] 无法读取网关密码 ${settingsFile}: ${err.message}`);
    return '';
  }
}

function parsePort() {
  const raw = Number(process.env.DSH_TUNNEL_PORT || DEFAULT_PROXY_PORT);
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : DEFAULT_PROXY_PORT;
}

function sendLogin(res, error = '', isApi = false) {
  if (isApi) {
    res.writeHead(401, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ error: 'unauthorized', message: error || '请重新登录' }));
    return;
  }
  const errHtml = error ? `<p style="color:#f87171">${error}</p>` : '';
  res.writeHead(401, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DSH 远程访问</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#0f1115;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .box{width:min(90vw,360px);padding:32px;background:#1e293b;border-radius:16px}
    h1{font-size:18px;margin:0 0 16px}
    input{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #475569;background:#0f1115;color:#fff}
    button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:8px;background:#3b82f6;color:#fff;cursor:pointer}
  </style>
</head>
<body>
  <form class="box" method="post" action="/api/auth/login">
    <h1>DSH 远程访问</h1>
    ${errHtml}
    <input name="password" type="password" placeholder="请输入访问密码" autofocus>
    <button type="submit">进入 DSH</button>
  </form>
</body>
</html>`);
}

function handleLogin(req, res, password, authHash) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 8192) req.destroy();
  });
  req.on('end', () => {
    const params = new URLSearchParams(body);
    if (hashPassword(params.get('password') || '') === authHash) {
      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': buildAuthCookie(password),
      });
      res.end();
      return;
    }
    sendLogin(res, '密码错误', true);
  });
}

function handleRequest(req, res, password, authHash, upstream) {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    handleLogin(req, res, password, authHash);
    return;
  }

  const queryPassword = url.searchParams.get('password');
  if (queryPassword) {
    if (hashPassword(queryPassword) === authHash) {
      url.searchParams.delete('password');
      const location = url.pathname === '/' ? '/' : url.pathname + url.search;
      res.writeHead(302, {
        Location: location,
        'Set-Cookie': buildAuthCookie(password),
      });
      res.end();
      return;
    }
    sendLogin(res, '密码错误', true);
    return;
  }

  if (!isDashboardAuthorized(req, password)) {
    sendLogin(res, '', url.pathname.startsWith('/api/'));
    return;
  }

  proxyHttp(req, res, upstream);
}

function proxyHttp(req, res, upstream) {
  const target = new URL(req.url, upstream);
  const headers = { ...rewriteBrowserHeaders(req.headers), host: target.host };
  delete headers.connection;
  delete headers['proxy-connection'];

  const upstreamReq = http.request(target, { method: req.method, headers }, (upstreamRes) => {
    const outHeaders = { ...upstreamRes.headers };
    for (const name of [
      'connection', 'keep-alive',
      'proxy-authenticate', 'proxy-authorization',
      'te', 'trailer', 'transfer-encoding', 'upgrade',
    ]) delete outHeaders[name];
    res.writeHead(upstreamRes.statusCode || 502, outHeaders);
    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `dsh upstream error: ${err.message}` }));
    } else {
      res.destroy();
    }
  });
  req.on('error', () => upstreamReq.destroy());
  req.pipe(upstreamReq);
}

// WebSocket upgrade 转发（DSH 前端依赖）
function proxyUpgrade(req, socket, head, password, upstream) {
  if (!isDashboardAuthorized(req, password)) {
    socket.destroy();
    return;
  }
  const target = new URL(req.url, upstream);
  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || 80,
    path: target.pathname + target.search,
    method: req.method || 'GET',
    headers: { ...rewriteBrowserHeaders(req.headers), host: target.host },
  };
  const upstreamReq = http.request(options);
  upstreamReq.on('upgrade', (res, upstreamSocket, upstreamHead) => {
    const headBuf = Buffer.from(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      Object.entries(res.headers).map(([k, v]) => `${k}: ${v}\r\n`).join('') +
      `\r\n`,
    );
    socket.write(headBuf);
    if (upstreamHead && upstreamHead.length) upstreamSocket.unshift(upstreamHead);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    socket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => socket.destroy());
  });
  upstreamReq.on('response', () => {
    // 非 upgrade 响应：不支持，直接断开
    socket.destroy();
  });
  upstreamReq.on('error', () => socket.destroy());
  upstreamReq.end(head && head.length ? head : undefined);
}

function resolveCloudflared() {
  const candidates = [
    process.env.CLOUDFLARED_PATH,
    path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft',
      'WinGet',
      'Packages',
      'Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe',
      'cloudflared.exe',
    ),
    'cloudflared',
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === 'cloudflared' || fs.existsSync(candidate)) || null;
}

function writeTunnelState(url, pid, localPort) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    url,
    pid,
    localPort,
    upstream: process.env.DSH_TUNNEL_UPSTREAM || DEFAULT_UPSTREAM,
    startedAt: new Date().toISOString(),
  }, null, 2));
}

function clearTunnelState(pid) {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    if (state.pid === pid) fs.rmSync(STATE_FILE);
  } catch {
    // ignore
  }
}

function startCloudflared(localPort) {
  const cmd = resolveCloudflared();
  if (!cmd) {
    console.error('[dsh-tunnel] 找不到 cloudflared，请安装或设置 CLOUDFLARED_PATH');
    process.exit(1);
  }
  const child = spawn(cmd, [
    'tunnel', '--url', `http://127.0.0.1:${localPort}`,
    '--no-autoupdate', '--grace-period', '5s',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let urlFound = false;
  const onData = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    const match = text.match(TUNNEL_URL_RE);
    if (match && !urlFound) {
      urlFound = true;
      const url = match[0];
      writeTunnelState(url, child.pid, localPort);
      console.log(`[dsh-tunnel] DSH 隧道: ${url}`);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (err) => {
    console.error(`[dsh-tunnel] cloudflared 启动失败: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => {
    clearTunnelState(child.pid);
    console.error(`[dsh-tunnel] cloudflared 退出 code=${code}`);
    process.exit(code || 1);
  });
  return child;
}

function main() {
  const password = readPassword();
  if (!password) {
    console.error('[dsh-tunnel] 未配置访问密码，拒绝启动（gateway.password）');
    process.exit(1);
  }
  const authHash = hashPassword(password);
  const proxyPort = parsePort();
  const upstream = process.env.DSH_TUNNEL_UPSTREAM || DEFAULT_UPSTREAM;

  const server = http.createServer((req, res) => handleRequest(req, res, password, authHash, upstream));
  server.on('upgrade', (req, socket, head) => proxyUpgrade(req, socket, head, password, upstream));
  server.on('error', (err) => {
    console.error(`[dsh-tunnel] 代理端口 ${proxyPort} 启动失败: ${err.message}`);
    process.exit(1);
  });

  server.listen(proxyPort, '127.0.0.1', () => {
    console.log(`[dsh-tunnel] 认证代理: http://127.0.0.1:${proxyPort} -> ${upstream}`);
    startCloudflared(proxyPort);
  });

  const shutdown = () => {
    server.close();
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
