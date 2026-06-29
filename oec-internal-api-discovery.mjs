// oec-internal-api-discovery.mjs
// 巨量引擎内部 API 端点发现器
// 使用 CDP Network 域拦截 OceanEngine 页面的 XHR 请求
// 一次性运行，输出现有的内部 API 端点
// 用法: node oec-internal-api-discovery.mjs

import fs from 'node:fs';
import path from 'node:path';
import { quickConnect, getOceanEngineTab } from './cdp-client.mjs';
import { sleep } from './wait-utils.mjs';
import { CAMPAIGN_URL, DATA_DIR } from './monitor-utils.mjs';
import WebSocket from 'ws';
import http from 'node:http';

const OUTPUT_FILE = path.join(DATA_DIR, 'oec-internal-apis.json');

// 直接用 WebSocket 连接，因为 CDP Network 域的控制需要更底层的消息监听
async function discover() {
  console.log('🔍 巨量引擎 内部API 端点发现器\n');

  // 1. 找标签页
  const tab = await getOceanEngineTab(['投放管理', '巨量引擎工作台']);
  if (!tab) {
    console.log('❌ 未找到巨量引擎标签页');
    process.exit(1);
  }
  console.log(`📄 Tab: ${tab.title}`);

  // 2. 用原生 WebSocket 连接（需要监听 CDP 事件消息）
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let cmdId = 1;
  const pending = new Map();
  const capturedRequests = [];

  function wsSend(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = cmdId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('timeout'));
        }
      }, 15000);
    });
  }

  ws.on('message', (data) => {
    const d = Buffer.isBuffer(data) ? data.toString() : String(data || '');
    let msg;
    try { msg = JSON.parse(d); } catch { return; }

    // CDP 事件消息
    if (msg.method) {
      // Network.requestWillBeSent — 捕获请求URL
      if (msg.method === 'Network.requestWillBeSent') {
        const req = msg.params.request;
        const url = req.url || '';
        // 过滤：只要 API 请求，不要静态资源
        const isAPI = url.includes('/api/') || url.includes('/open_api/') ||
                      url.includes('oceanengine.com') && !url.match(/\.(js|css|png|jpg|gif|svg|woff|ico|ttf)/i);
        if (isAPI) {
          capturedRequests.push({
            url,
            method: req.method,
            headers: {
              contentType: (req.headers || {})['content-type'] || '',
              authorization: (req.headers || {})['authorization'] || '',
              referer: (req.headers || {})['referer'] || '',
              origin: (req.headers || {})['origin'] || '',
            },
            timestamp: new Date().toISOString(),
          });
          console.log(`  📡 ${req.method} ${url.substring(0, 120)}`);
        }
      }

      // Network.responseReceived — 捕获响应头
      if (msg.method === 'Network.responseReceived') {
        const resp = msg.params.response;
        const url = resp.url || '';
        for (const cr of capturedRequests) {
          if (cr.url === url) {
            cr.status = resp.status;
            cr.responseHeaders = {
              contentType: resp.headers['content-type'] || '',
              contentLength: resp.headers['content-length'] || '',
            };
            break;
          }
        }
      }
    }

    // 命令响应
    if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 10000);
  });

  console.log('✅ CDP 连接成功\n');

  // 3. 启用 Network 域
  await wsSend('Page.enable');
  await wsSend('Runtime.enable');
  await wsSend('Network.enable', {
    maxTotalBufferSize: 50000000,
    maxResourceBufferSize: 25000000,
  });
  await sleep(500);

  // 4. 导航到投放管理页（如果不在）
  const currentUrl = await wsSend('Runtime.evaluate', {
    expression: 'location.href',
    returnByValue: true,
  });
  const curUrl = currentUrl?.result?.result?.value || '';
  console.log(`当前URL: ${curUrl ? curUrl.substring(0, 80) : '?'}`);

  if (!curUrl.includes('promotion/promote-manage')) {
    console.log('导航到投放管理页...');
    await wsSend('Page.navigate', { url: CAMPAIGN_URL });
    await sleep(8000);
  } else {
    console.log('已在投放管理页，刷新获取最新请求...');
    await wsSend('Runtime.evaluate', {
      expression: 'location.reload(true)',
      returnByValue: false,
    });
    await sleep(8000);
  }

  // 5. 等待数据加载完成（等待汇总行出现）
  console.log('⏳ 等待数据加载...');
  for (let i = 0; i < 60; i++) {
    const r = await wsSend('Runtime.evaluate', {
      expression: 'document.querySelectorAll("tr.ovui-t-summary").length > 0',
      returnByValue: true,
    });
    if (r?.result?.result?.value === true) {
      console.log('✅ 数据已加载');
      break;
    }
    await sleep(1000);
  }

  // 6. 抓取所有 API 请求的完整响应体
  console.log('\n📦 获取请求响应体...');
  for (const cr of capturedRequests) {
    try {
      const resp = await wsSend('Network.getResponseBody', { requestId: cr.requestId });
      if (resp?.result?.body) {
        cr.responseBody = resp.result.body.substring(0, 5000); // 截取前5KB
        cr.bodyTruncated = resp.result.base64Encoded || resp.result.body.length > 5000;
      }
    } catch (e) {
      // 某些响应可能已被清理
      cr.responseBodyError = e.message?.substring(0, 80);
    }
  }

  // 7. 额外：抓取 cookies
  console.log('\n🍪 抓取 Cookies...');
  const cookiesResult = await wsSend('Network.getCookies', {
    urls: ['https://ad.oceanengine.com', 'https://sso.oceanengine.com'],
  });
  const cookies = cookiesResult?.result?.cookies || [];
  const essentialCookies = cookies.map(c => ({
    name: c.name,
    domain: c.domain,
    httpOnly: c.httpOnly,
    secure: c.secure,
    expires: c.expires,
  }));

  // 8. 额外：抓取 localStorage 中的 token
  console.log('🔑 抓取本地存储...');
  const localStorageResult = await wsSend('Runtime.evaluate', {
    expression: `
      (() => {
        const keys = ['token', 'access_token', 'refresh_token', 'user_token', 'csrf_token', 'XSRF-TOKEN'];
        const items = {};
        for (const k of keys) {
          try {
            const v = localStorage.getItem(k);
            if (v) items[k] = v.substring(0, 100) + (v.length > 100 ? '...' : '');
          } catch {}
        }
        // 也检查 sessionStorage
        for (const k of keys) {
          try {
            const v = sessionStorage.getItem(k);
            if (v) items[k + '_session'] = v.substring(0, 100) + (v.length > 100 ? '...' : '');
          } catch {}
        }
        return JSON.stringify(items, null, 2);
      })()
    `,
    returnByValue: true,
  });
  const localStorageData = localStorageResult?.result?.result?.value;

  ws.close();

  // 9. 整理输出
  const report = {
    discoveryTime: new Date().toISOString(),
    accountPage: CAMPAIGN_URL,
    summary: {
      totalRequests: capturedRequests.length,
      apiRequests: capturedRequests.filter(r => {
        const url = r.url.toLowerCase();
        return url.includes('/api/') || url.includes('/open_api/') || url.includes('ad.oceanengine.com');
      }).length,
    },

    // 按 API 模式分组
    apiEndpoints: groupByAPIPattern(capturedRequests),

    // 所有捕获的请求（去重）
    allRequests: deduplicateRequests(capturedRequests),

    // Cookies 概要
    cookies: essentialCookies,

    // 本地存储
    localStorage: localStorageData,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
  console.log(`\n📁 报告已保存: ${OUTPUT_FILE}`);
  console.log(`   共捕获 ${capturedRequests.length} 个请求`);
  console.log(`   发现 ${report.apiEndpoints.length} 个疑似API端点`);

  // 打印关键API端点
  if (report.apiEndpoints.length > 0) {
    console.log('\n🎯 关键API端点:');
    for (const ep of report.apiEndpoints) {
      console.log(`   ${ep.pattern.padEnd(50)} → x${ep.count}次`);
    }
  }

  return report;
}

// 分组API端点
function groupByAPIPattern(requests) {
  const groups = new Map();

  for (const req of requests) {
    const url = req.url;
    // 提取 API 路径模式
    let pattern = url;

    // 去掉 query 参数
    const qIdx = url.indexOf('?');
    if (qIdx > 0) pattern = url.substring(0, qIdx);

    // 去掉数字ID路径段
    pattern = pattern.replace(/\/\d{10,}/g, '/{id}');
    pattern = pattern.replace(/\/[a-f0-9-]{20,}/g, '/{uuid}');

    // 提取域名后的路径
    const hostMatch = pattern.match(/https?:\/\/[^/]+(.+)/);
    if (hostMatch) pattern = hostMatch[1];

    if (!groups.has(pattern)) {
      groups.set(pattern, { pattern, count: 0, methods: new Set(), sampleUrl: req.url });
    }
    const g = groups.get(pattern);
    g.count++;
    g.methods.add(req.method);
  }

  return Array.from(groups.values())
    .map(g => ({
      pattern: g.pattern,
      count: g.count,
      methods: Array.from(g.methods),
      sampleUrl: g.sampleUrl,
    }))
    .sort((a, b) => b.count - a.count);
}

function deduplicateRequests(requests) {
  const seen = new Set();
  return requests.filter(r => {
    const key = `${r.method}:${r.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(r => ({
    method: r.method,
    url: r.url,
    status: r.status,
    contentType: r.responseHeaders?.contentType || r.headers?.contentType || '',
  }));
}

// 运行
discover().catch(e => {
  console.error('❌ 发现失败:', e.message);
  process.exit(1);
});
