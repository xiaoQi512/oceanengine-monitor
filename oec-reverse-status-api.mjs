// oec-reverse-status-api.mjs — 逆向巨量引擎暂停/启动 HTTP API
// 
// 用法: node oec-reverse-status-api.mjs
// 功能: CDP 连接浏览器 → 拦截 Network 请求 → 等待用户手动点击暂停/恢复开关
//       → 捕获请求体(postData)和响应 → 输出完整 API 签名
//
// 前置条件: Chrome 已打开巨量引擎投放管理页面，已登录

import fs from 'node:fs';
import path from 'node:path';
import { quickConnect, getOceanEngineTab } from './cdp-client.mjs';
import { sleep } from './wait-utils.mjs';
import { DATA_DIR } from './monitor-utils.mjs';
import WebSocket from 'ws';

const OUTPUT_FILE = path.join(DATA_DIR, 'oec-status-api-reverse.json');

async function reverse() {
  console.log('🔍 逆向巨量引擎 暂停/启动 HTTP API\n');
  console.log('📋 操作说明:');
  console.log('  1. 确保 Chrome 已打开巨量引擎投放管理页面');
  console.log('  2. 脚本会自动连接并开始监听');
  console.log('  3. 在 Chrome 中手动点某个计划的 暂停按钮 或 恢复开关');
  console.log('  4. 脚本会捕获完整的 API 请求和响应');
  console.log('  5. 按 Ctrl+C 或等 120 秒自动退出\n');

  // 1. 连接 Chrome
  const tab = await getOceanEngineTab(['投放管理', '巨量引擎工作台']);
  if (!tab) {
    console.log('❌ 未找到巨量引擎标签页，请先在 Chrome 中打开投放管理页面');
    process.exit(1);
  }
  console.log(`📄 标签页: ${tab.title}`);

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let cmdId = 1;
  const pending = new Map();

  // 存储捕获结果
  const captured = [];

  function wsSend(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = cmdId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); }
      }, 30000);
    });
  }

  ws.on('message', (data) => {
    const d = Buffer.isBuffer(data) ? data.toString() : String(data || '');
    let msg;
    try { msg = JSON.parse(d); } catch { return; }

    // CDP 事件
    if (msg.method) {
      if (msg.method === 'Network.requestWillBeSent') {
        const req = msg.params.request;
        const rid = msg.params.requestId;
        const url = req.url || '';
        const method = req.method || '';
        const postData = msg.params.request?.postData || '';

        // 只看 POST 请求（状态变更通常是 POST）
        if (method === 'POST' && url.includes('ad.oceanengine.com')) {
          captured.push({
            requestId: rid,
            method,
            url,
            postData: postData ? postData.substring(0, 10000) : '',
            headers: req.headers || {},
            timestamp: new Date().toISOString(),
          });

          console.log(`\n📡 ${method} ${url}`);
          if (postData) {
            try {
              const pretty = JSON.stringify(JSON.parse(postData), null, 2);
              console.log(`   Body (${postData.length} chars):`);
              console.log(`   ${pretty.split('\n').join('\n   ')}`);
            } catch {
              console.log(`   Body: ${postData.substring(0, 200)}`);
            }
          }
        }
      }

      // 捕获响应
      if (msg.method === 'Network.responseReceived') {
        const resp = msg.params.response;
        const url = resp.url || '';
        const rid = msg.params.requestId;
        for (const c of captured) {
          if (c.requestId === rid) {
            c.status = resp.status;
            c.responseHeaders = resp.headers;
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

  console.log('✅ CDP 连接成功，开始监听...\n');

  // 2. 启用 Network 域
  await wsSend('Page.enable');
  await wsSend('Runtime.enable');
  await wsSend('Network.enable', {
    maxTotalBufferSize: 100000000,
    maxResourceBufferSize: 50000000,
  });
  await sleep(500);

  // 3. 刷新页面以捕获所有 API 请求
  console.log('🔄 刷新页面捕获 API 请求...');
  await wsSend('Runtime.evaluate', {
    expression: 'location.reload(true)',
    returnByValue: false,
  });
  console.log('   等待页面加载 (15s)...');
  await sleep(15000);
  console.log(`   已捕获 ${captured.length} 个 POST 请求`);

  // 4. 等待用户在投放管理页面点击暂停/恢复开关
  console.log('\n⏳ 请在 Chrome 中点击任意计划的暂停按钮或恢复开关（最长 180s）...\n');

  const startTime = Date.now();
  const maxWait = 180000; // 3 分钟
  const beforeCount = captured.length; // 记录刷新后的请求数量

  while (true) {
    await sleep(3000);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // 只关注刷新之后新增的、含 postData 的 POST 请求
    const newRequests = captured.filter(c =>
      c.postData && captured.indexOf(c) >= beforeCount
    );

    // 目标：含 状态/更新 关键词
    const targetRequests = newRequests.filter(c => {
      const pd = (c.postData || '').toLowerCase();
      const url = (c.url || '').toLowerCase();
      return pd.includes('status') || pd.includes('enable') ||
             pd.includes('pause') || pd.includes('resume') ||
             pd.includes('stop') || pd.includes('start') ||
             url.includes('update') || url.includes('modify') ||
             url.includes('operate') || url.includes('toggle');
    });

    if (targetRequests.length > 0) {
      console.log(`\n✅ 捕获到 ${targetRequests.length} 个疑似状态变更请求！(用时 ${elapsed}s)`);
      break;
    }

    if (elapsed > 180) {
      console.log('\n⏰ 超时(180s)，回退：输出所有已捕获的 POST 请求');
      break;
    }

    if (elapsed % 15 === 0) {
      process.stdout.write(`\r  已等待 ${elapsed}s, 新增 ${newRequests.length} 个 POST...`);
    }
  }
  console.log();

  // 5. 获取响应体
  console.log('\n📦 获取响应体...');
  for (const c of captured) {
    if (!c.postData) continue;
    try {
      const resp = await wsSend('Network.getResponseBody', { requestId: c.requestId });
      if (resp?.result?.body) {
        c.responseBody = resp.result.body.substring(0, 10000);
        try {
          c.responseJson = JSON.parse(c.responseBody);
        } catch {}
      }
    } catch (e) {
      c.responseBodyError = e.message?.substring(0, 80);
    }
  }

  ws.close();

  // 5. 分析结果
  console.log('\n📊 分析捕获的请求...');

  const actionable = captured.filter(c => c.postData);
  console.log(`   总计 ${captured.length} 个 POST 请求`);
  console.log(`   含请求体的 ${actionable.length} 个`);

  // 尝试识别状态变更 API
  const statusCandidates = actionable.filter(c => {
    const pd = c.postData.toLowerCase();
    return pd.includes('status') ||
           pd.includes('enable') ||
           pd.includes('pause') ||
           pd.includes('resume') ||
           pd.includes('stop') ||
           pd.includes('start');
  });

  if (statusCandidates.length > 0) {
    console.log(`\n🎯 识别到 ${statusCandidates.length} 个状态相关请求:`);
    for (const s of statusCandidates) {
      console.log(`\n   === API 签名 ===`);
      console.log(`   URL: ${s.url}`);
      console.log(`   Method: ${s.method}`);
      console.log(`   Status: ${s.status}`);
      if (s.postData) {
        try {
          console.log(`   Body: ${JSON.stringify(JSON.parse(s.postData), null, 2).split('\n').join('\n         ')}`);
        } catch {
          console.log(`   Body: ${s.postData}`);
        }
      }
      if (s.responseBody) {
        console.log(`   Response: ${s.responseBody.substring(0, 300)}`);
      }
    }
  } else {
    console.log('\n⚠ 未找到明显包含状态字段的请求');
    console.log('   请查看所有捕获的 POST 请求：');
    for (const a of actionable) {
      console.log(`\n   ${a.method} ${a.url}`);
      if (a.postData) console.log(`   Body: ${a.postData.substring(0, 200)}`);
    }
  }

  // 6. 保存完整报告
  const report = {
    captureTime: new Date().toISOString(),
    totalPostRequests: captured.length,
    actionableRequests: actionable.length,
    statusCandidates: statusCandidates.map(s => ({
      url: s.url,
      method: s.method,
      status: s.status,
      postData: s.postData,
      responseJson: s.responseJson || null,
      responseBody: s.responseBody || null,
    })),
    allPostRequests: captured.map(c => ({
      url: c.url,
      method: c.method,
      status: c.status,
      postData: c.postData?.substring(0, 500) || '',
    })),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
  console.log(`\n📁 完整报告: ${OUTPUT_FILE}`);
}

reverse().catch(e => {
  console.error('❌ 逆向失败:', e.message);
  // 即使失败也打印已捕获的数据
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
