// oec-reverse-stats-api.mjs
// 逆向工程脚本：捕获 statistcs_sophonx/statQuery 和 customize_report/data 的完整请求/响应
// 用法: node oec-reverse-stats-api.mjs

import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { getOceanEngineTab } from './cdp-client.mjs';
import { sleep } from './wait-utils.mjs';
import { DATA_DIR, CAMPAIGN_URL } from './monitor-utils.mjs';

const OUTPUT_FILE = path.join(DATA_DIR, 'oec-reverse-stats-dump.json');

const TARGET_APIS = [
  'statQuery',
  'customize_report/data',
  'projects/list',
  'ads/list',
  'dashboard_stats',
  'account_wallet',
];

async function main() {
  console.log('🔍 逆向工程：捕获统计API完整请求\n');

  const tab = await getOceanEngineTab(['投放管理', '巨量引擎工作台']);
  if (!tab) { console.log('❌ 无标签页'); process.exit(1); }

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let cmdId = 1;
  const pending = new Map();
  const captures = [];

  function wsSend(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = cmdId++;
      const timer = setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); }
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.on('message', (data) => {
    const d = Buffer.isBuffer(data) ? data.toString() : String(data || '');
    let msg;
    try { msg = JSON.parse(d); } catch { return; }

    // CDP 事件
    if (msg.method === 'Network.requestWillBeSent') {
      const req = msg.params.request;
      const url = req.url || '';

      const isTarget = TARGET_APIS.some(api => url.includes(api));
      if (!isTarget) return;

      const entry = {
        requestId: msg.params.requestId,
        url,
        method: req.method,
        postData: req.postData || '',
        headers: req.headers || {},
        timestamp: Date.now(),
      };
      captures.push(entry);

      console.log(`  📡 ${req.method} ${url.substring(url.indexOf('/ad/api/') > 0 ? url.indexOf('/ad/api/') : 0).substring(0, 100)}`);
      if (req.postData) {
        console.log(`     Body: ${req.postData.substring(0, 200)}`);
      }
    }

    if (msg.method === 'Network.responseReceived') {
      const resp = msg.params.response;
      const url = resp.url || '';
      const entry = captures.find(c => c.url === url);
      if (entry) {
        entry.status = resp.status;
        entry.responseHeaders = resp.headers;
      }
    }

    if (msg.id && pending.has(msg.id)) {
      const { resolve, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    setTimeout(() => reject(new Error('ws connect timeout')), 10000);
  });

  console.log('✅ CDP已连接\n');

  // 启用域
  await wsSend('Page.enable');
  await wsSend('Runtime.enable');
  await wsSend('Network.enable', {
    maxTotalBufferSize: 100000000,
    maxResourceBufferSize: 50000000,
    maxPostDataSize: 65536,
  });
  await sleep(300);

  // 导航+刷新
  const curUrl = (await wsSend('Runtime.evaluate', { expression: 'location.href', returnByValue: true }))?.result?.result?.value || '';
  console.log(`当前URL: ${curUrl?.substring(0, 80)}`);

  if (!curUrl.includes('promotion/promote-manage/project')) {
    console.log('导航到投放管理页...');
    await wsSend('Page.navigate', { url: CAMPAIGN_URL });
    await sleep(8000);
  } else {
    console.log('刷新页面获取完整请求序列...');
    await wsSend('Runtime.evaluate', { expression: 'location.reload(true)', returnByValue: false });
    await sleep(3000); // Network事件可能在这期间到达
  }

  // 等待数据加载（等更久确保所有stats请求都发出）
  console.log('\n⏳ 等待所有网络请求完成 (15s)...');
  // 先等汇总行出现
  for (let i = 0; i < 30; i++) {
    const r = await wsSend('Runtime.evaluate', {
      expression: 'document.querySelectorAll("tr.ovui-t-summary").length > 0',
      returnByValue: true,
    });
    if (r?.result?.result?.value === true) break;
    await sleep(1000);
  }
  // 再等额外5s确保延迟的stats请求也完成
  await sleep(5000);

  // 获取每个捕获请求的响应体
  console.log(`\n📦 获取 ${captures.length} 个请求的响应体...`);
  for (const entry of captures) {
    try {
      const resp = await wsSend('Network.getResponseBody', { requestId: entry.requestId });
      if (resp?.result) {
        if (resp.result.base64Encoded) {
          entry.responseBody = Buffer.from(resp.result.body, 'base64').toString('utf-8');
        } else {
          entry.responseBody = resp.result.body;
        }
        // 截断过长的响应
        if (entry.responseBody.length > 10000) {
          entry.responseBody = entry.responseBody.substring(0, 10000) + '\n... [TRUNCATED]';
        }
      }
    } catch (e) {
      entry.responseError = e.message?.substring(0, 60);
    }
  }

  // 只保留有响应体的目标API
  const relevant = captures.filter(c =>
    c.responseBody || c.postData
  );

  // 按API分组组织输出
  const grouped = {};
  for (const c of relevant) {
    const apiName = TARGET_APIS.find(a => c.url.includes(a)) || 'other';
    if (!grouped[apiName]) grouped[apiName] = [];
    grouped[apiName].push({
      method: c.method,
      url: c.url,
      status: c.status,
      postData: c.postData,
      responsePreview: c.responseBody?.substring(0, 1000),
      responseLength: c.responseBody?.length || 0,
    });
  }

  const report = {
    capturedAt: new Date().toISOString(),
    totalCaptures: captures.length,
    relevantCaptures: relevant.length,
    apiGroups: grouped,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
  console.log(`\n📁 报告: ${OUTPUT_FILE}`);

  // 打印关键发现
  console.log('\n🎯 关键发现:');
  for (const [apiName, entries] of Object.entries(grouped)) {
    console.log(`\n=== ${apiName} (${entries.length}次) ===`);
    for (const e of entries.slice(0, 3)) {
      console.log(`  ${e.method} [${e.status}]`);
      if (e.postData) console.log(`  → Body: ${e.postData.substring(0, 200)}`);
      if (e.responsePreview) console.log(`  ← Response: ${e.responsePreview.substring(0, 300)}`);
    }
  }

  ws.close();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
