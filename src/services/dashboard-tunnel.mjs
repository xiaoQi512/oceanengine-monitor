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
const STATE_FILE = path.join(ROOT, 'monitor-data', 'dashboard-tunnel.json');
const GATEWAY_LAST_URL_FILE = path.resolve(ROOT, '..', '.gateway_last_url.txt');
const DEFAULT_SETTINGS_FILE = 'C:/Users/HTF2026/.codebuddy/settings.json';
const DEFAULT_PROXY_PORT = 8898;
const DEFAULT_UPSTREAM = 'http://127.0.0.1:8899';
const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function readPassword() {
  if (process.env.DASHBOARD_TUNNEL_PASSWORD) return process.env.DASHBOARD_TUNNEL_PASSWORD;
  const settingsFile = process.env.CODEBUDDY_SETTINGS_PATH || DEFAULT_SETTINGS_FILE;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    return settings?.gateway?.password || '';
  } catch (err) {
    console.error(`[dashboard-tunnel] 无法读取网关密码 ${settingsFile}: ${err.message}`);
    return '';
  }
}

function parsePort() {
  const raw = Number(process.env.DASHBOARD_TUNNEL_PORT || DEFAULT_PROXY_PORT);
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : DEFAULT_PROXY_PORT;
}

function sendLogin(res, error = '') {
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
  <title>巨量引擎监控 · 远程访问</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .box{width:min(90vw,360px);padding:32px;background:#1e293b;border-radius:16px}
    h1{font-size:18px;margin:0 0 16px}
    input{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#fff}
    button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:8px;background:#3b82f6;color:#fff;cursor:pointer}
  </style>
</head>
<body>
  <form class="box" method="post" action="/api/auth/login">
    <h1>巨量引擎监控远程访问</h1>
    ${errHtml}
    <input name="password" type="password" placeholder="请输入访问密码" autofocus>
    <button type="submit">进入仪表盘</button>
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
        Location: '/dashboard-v4',
        'Set-Cookie': buildAuthCookie(password),
      });
      res.end();
      return;
    }
    sendLogin(res, '密码错误');
  });
}

function handleRequest(req, res, password, authHash) {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    handleLogin(req, res, password, authHash);
    return;
  }

  const queryPassword = url.searchParams.get('password');
  if (queryPassword) {
    if (hashPassword(queryPassword) === authHash) {
      url.searchParams.delete('password');
      const location = url.pathname === '/' ? '/dashboard-v4' : url.pathname + url.search;
      res.writeHead(302, {
        Location: location,
        'Set-Cookie': buildAuthCookie(password),
      });
      res.end();
      return;
    }
    sendLogin(res, '密码错误');
    return;
  }

  if (!isDashboardAuthorized(req, password)) {
    sendLogin(res);
    return;
  }

  proxyToDashboard(req, res);
}

function proxyToDashboard(req, res) {
  const upstream = process.env.DASHBOARD_UPSTREAM || DEFAULT_UPSTREAM;
  const target = new URL(req.url, upstream);
  const headers = { ...req.headers, host: target.host };
  delete headers.connection;
  delete headers['proxy-connection'];

  const upstreamReq = http.request(target, { method: req.method, headers }, (upstreamRes) => {
    const outHeaders = { ...upstreamRes.headers };
    for (const name of [
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
    ]) delete outHeaders[name];
    res.writeHead(upstreamRes.statusCode || 502, outHeaders);
    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `dashboard upstream error: ${err.message}` }));
    } else {
      res.destroy();
    }
  });
  req.on('error', () => upstreamReq.destroy());
  req.pipe(upstreamReq);
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
    startedAt: new Date().toISOString(),
  }, null, 2));
}

function readTunnelStateUrl() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')).url || '';
  } catch {
    return '';
  }
}

function readGatewayLastUrl() {
  try {
    return fs.readFileSync(GATEWAY_LAST_URL_FILE, 'utf-8').trim();
  } catch {
    return '';
  }
}

function notifyDashboardTunnel() {
  const gatewayUrl = readGatewayLastUrl();
  const script = path.resolve(ROOT, '..', 'send_gateway_to_feishu.py');
  const python = process.env.PYTHON || 'python';
  const child = spawn(python, [script, '--dashboard-only', gatewayUrl], {
    stdio: 'ignore',
    windowsHide: true,
    cwd: path.dirname(script),
  });
  child.on('error', (err) => console.error(`[dashboard-tunnel] 飞书通知失败: ${err.message}`));
  child.unref();
}

function clearTunnelState(pid) {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    if (state.pid === pid) fs.rmSync(STATE_FILE);
  } catch {
    // 状态文件不存在或损坏时无需处理
  }
}

function startCloudflared(localPort) {
  const cmd = resolveCloudflared();
  if (!cmd) {
    console.error('[dashboard-tunnel] 找不到 cloudflared，请在 PATH 安装或设置 CLOUDFLARED_PATH');
    process.exit(1);
  }
  const child = spawn(cmd, [
    'tunnel',
    '--url',
    `http://127.0.0.1:${localPort}`,
    '--no-autoupdate',
    '--grace-period',
    '5s',
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
      const previousUrl = readTunnelStateUrl();
      writeTunnelState(url, child.pid, localPort);
      console.log(`[dashboard-tunnel] 仪表盘隧道: ${url}`);
      if (previousUrl !== url) notifyDashboardTunnel();
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (err) => {
    console.error(`[dashboard-tunnel] cloudflared 启动失败: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => {
    clearTunnelState(child.pid);
    console.error(`[dashboard-tunnel] cloudflared 退出 code=${code}`);
    process.exit(code || 1);
  });
  return child;
}

function main() {
  const password = readPassword();
  if (!password) {
    console.error('[dashboard-tunnel] 未配置访问密码，拒绝启动');
    process.exit(1);
  }
  const authHash = hashPassword(password);
  const proxyPort = parsePort();
  const server = http.createServer((req, res) => handleRequest(req, res, password, authHash));
  let child = null;

  server.on('error', (err) => {
    console.error(`[dashboard-tunnel] 代理端口 ${proxyPort} 启动失败: ${err.message}`);
    process.exit(1);
  });
  server.listen(proxyPort, '127.0.0.1', () => {
    console.log(`[dashboard-tunnel] 认证代理: http://127.0.0.1:${proxyPort} -> ${process.env.DASHBOARD_UPSTREAM || DEFAULT_UPSTREAM}`);
    child = startCloudflared(proxyPort);
  });

  const shutdown = () => {
    if (child) child.kill();
    server.close();
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
