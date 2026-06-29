// capture-ai-regions-api.mjs — 捕获 AI区域号 customize_report/data 的完整 POST body + 响应
// 用法: node capture-ai-regions-api.mjs [regionIndex]
//   regionIndex: 0-4 (东/西/中/南/区), 默认 0 (东区)
//
// 流程:
//   1. CDP HTTP /json/new 打开新 tab → AI区域报表页
//   2. WebSocket 连接 → Network.enable (maxPostDataSize=256KB)
//   3. 监听 Network.requestWillBeSent → 匹配 customize_report/data
//   4. 监听 Network.loadingFinished → getResponseBody
//   5. 输出完整 postData + response → monitor-data/ai-regions-api-capture.json
//   6. 关闭 tab (不污染主账户上下文)

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { WebSocket } from 'ws';
import { AI_REGIONS, DATA_DIR } from './monitor-utils.mjs';

const regionIdx = parseInt(process.argv[2] || '0', 10);
const region = AI_REGIONS[regionIdx];
if (!region) {
  console.error(`❌ 无效 regionIndex: ${regionIdx}, 可选 0-4`);
  process.exit(1);
}

const REPORT_URL = `https://ad.oceanengine.com/statistics_pages/ad_report/customize/report/detail/${region.reportId}?aadvid=${region.aadvid}`;
const OUTPUT_FILE = path.join(DATA_DIR, `ai-regions-api-capture-${region.name}.json`);
const CDP_HTTP = 'http://localhost:9222';
const CAPTURE_TIMEOUT_MS = 60000;  // 单区域最多等 60s
const TARGET_API = 'statistics_sophonx/statQuery';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ====== 1. 创建新 tab ======
function createTab(url) {
  return new Promise((resolve, reject) => {
    // Chrome CDP HTTP API: PUT /json/new?url
    const req = http.request(`${CDP_HTTP}/json/new`, {
      method: 'PUT',
      timeout: 10000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('create tab timeout')); });
    // Chrome 要求 URL 在 query 参数 (PUT 无 body)
    // 实际 CDP: PUT /json/new?url=<encoded>
    // 但 http.request 不会自动加 query, 手动改 path
    req.path = `/json/new?${encodeURIComponent(url)}`;
    req.end();
  });
}

// ====== 2. 关闭 tab ======
function closeTab(targetId) {
  return new Promise(resolve => {
    const req = http.get(`${CDP_HTTP}/json/close/${targetId}`, { timeout: 5000 }, res => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ====== 3. WebSocket 监听 ======
async function captureApiCalls(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let cmdId = 1;
    const pending = new Map();
    const captures = [];
    const allApiUrls = [];
    let allRequestCount = 0;
    let resolved = false;

    function wsSend(method, params = {}) {
      return new Promise((res, rej) => {
        const id = cmdId++;
        const timer = setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); rej(new Error('timeout: ' + method)); }
        }, 15000);
        pending.set(id, { resolve: res, reject: rej, timer });
        try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { rej(e); }
      });
    }

    ws.on('message', (raw) => {
      const data = Buffer.isBuffer(raw) ? raw.toString() : String(raw || '');
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      // 响应消息
      if (msg.id && pending.has(msg.id)) {
        const { resolve, timer } = pending.get(msg.id);
        clearTimeout(timer);
        pending.delete(msg.id);
        resolve(msg);
        return;
      }

      // 事件
      if (!msg.method) return;

      // 收集所有POST请求 + 报表相关GET (用于分析)
      if (msg.method === 'Network.requestWillBeSent') {
        const req = msg.params.request;
        const url = req.url || '';
        allRequestCount++;

        if (url.includes(TARGET_API)) {
          const entry = {
            requestId: msg.params.requestId,
            url,
            method: req.method,
            postData: req.postData || '',
            postDataLength: req.postData?.length || 0,
            headers: req.headers || {},
            timestamp: msg.params.timestamp,
            capturedAt: new Date().toISOString(),
          };
          captures.push(entry);
          console.log(`  📡 捕获 #${captures.length}: ${req.method} ${url.slice(0, 100)}`);
          if (req.postData) {
            console.log(`     Body 长度: ${req.postData.length} 字节`);
          }
        }

        // 同时收集所有POST + 报表相关URL (用于事后分析)
        const isPost = req.method === 'POST';
        const isReportRelated = /report|stat|custom|sophon|agw|data/i.test(url)
          && !/\.(js|css|png|jpg|svg|woff|ico|gif)/i.test(url);
        if (isPost || isReportRelated) {
          allApiUrls.push({
            method: req.method,
            url: url.length > 300 ? url.slice(0, 300) : url,
            hasPostData: !!req.postData,
            postDataLen: req.postData?.length || 0,
            postDataPreview: req.postData ? req.postData.slice(0, 500) : '',
          });
        }
      }

      if (msg.method === 'Network.loadingFinished') {
        const reqId = msg.params.requestId;
        const entry = captures.find(c => c.requestId === reqId);
        if (entry && !entry.responseBody) {
          // 异步取响应体
          wsSend('Network.getResponseBody', { requestId: reqId }).then(resp => {
            if (resp?.result) {
              entry.responseBody = resp.result.base64Encoded
                ? Buffer.from(resp.result.body, 'base64').toString('utf-8')
                : resp.result.body;
              entry.responseLength = entry.responseBody?.length || 0;
              console.log(`  ✅ 响应体 ${entry.responseLength} 字节`);
              // 截断保存 (完整版单独存)
              entry.responsePreview = entry.responseBody.slice(0, 2000);
            }
          }).catch(() => {});
        }
      }
    });

    ws.once('open', async () => {
      try {
        await wsSend('Page.enable');
        await wsSend('Runtime.enable');
        await wsSend('Network.enable', {
          maxTotalBufferSize: 200000000,
          maxResourceBufferSize: 100000000,
          maxPostDataSize: 262144,  // 256KB
        });
        resolve({ ws, wsSend, getCaptures: () => captures, getAllCount: () => allRequestCount, getAllApiUrls: () => allApiUrls });
      } catch (e) {
        reject(e);
      }
    });

    ws.once('error', reject);
    setTimeout(() => {
      if (!resolved) reject(new Error('ws connect timeout'));
    }, 10000);
  });
}

// ====== 主流程 ======
async function main() {
  console.log(`\n🔍 AI区域号 API 抓包: ${region.name}\n`);
  console.log(`报表URL: ${REPORT_URL}\n`);
  console.log(`目标API: ${TARGET_API}\n`);

  // Step 1: 创建 tab
  console.log('▶ 创建新 tab...');
  const tabInfo = await createTab(REPORT_URL);
  if (!tabInfo.id || !tabInfo.webSocketDebuggerUrl) {
    console.error('❌ 创建 tab 失败:', JSON.stringify(tabInfo).slice(0, 200));
    process.exit(1);
  }
  console.log(`✅ Tab 已创建: id=${tabInfo.id.slice(0, 12)}... title="${tabInfo.title || ''}"`);

  try {
    // Step 2: 连接 WebSocket
    console.log('▶ 连接 CDP WebSocket...');
    const { ws, wsSend, getCaptures, getAllCount, getAllApiUrls } = await captureApiCalls(tabInfo.webSocketDebuggerUrl);
    console.log('✅ CDP 已连接, Network 域已启用\n');

    // Step 3: 等待页面加载 + API 请求触发
    console.log(`⏳ 等待页面加载 + ${TARGET_API} 请求 (最多 ${CAPTURE_TIMEOUT_MS / 1000}s)...`);

    // 页面可能需要 JS 交互触发, 先等自然加载
    let lastCount = 0;
    const startTime = Date.now();
    while (Date.now() - startTime < CAPTURE_TIMEOUT_MS) {
      await sleep(2000);
      const caps = getCaptures();
      if (caps.length > 0) {
        // 已捕获至少1个, 再等 5s 确保响应体也拿到
        if (caps.length === lastCount) {
          // 没有新增, 等响应体
          const allHaveResp = caps.every(c => c.responseBody || c.responsePreview);
          if (allHaveResp) break;
        }
        lastCount = caps.length;
      }
      process.stdout.write(`\r  已捕获 ${caps.length} 个 ${TARGET_API} 请求 / 总 ${getAllCount()} 个请求...`);
    }
    console.log('');

    // Step 4: 收集结果
    const captures = getCaptures();
    if (captures.length === 0) {
      console.log(`\n⚠ 未捕获到 ${TARGET_API} 请求`);
      console.log(`  可能原因: 页面未触发报表加载, 或 URL 不对`);
      // 尝试触发: 点击刷新按钮 / 切换日期
      console.log('  尝试触发: 页面 reload...');
      try {
        await wsSend('Page.reload', {});
        await sleep(10000);
      } catch {}
      const caps2 = getCaptures();
      if (caps2.length > 0) {
        console.log(`  ✅ reload 后捕获 ${caps2.length} 个`);
      }
    }

    const finalCaptures = getCaptures();
    console.log(`\n📊 最终捕获: ${finalCaptures.length} 个 ${TARGET_API} 请求\n`);

    // Step 5: 保存
    const report = {
      region: region.name,
      aadvid: region.aadvid,
      reportId: region.reportId,
      capturedAt: new Date().toISOString(),
      reportUrl: REPORT_URL,
      totalRequestsObserved: getAllCount(),
      targetApi: TARGET_API,
      captureCount: finalCaptures.length,
      captures: finalCaptures.map(c => ({
        method: c.method,
        url: c.url,
        postData: c.postData,
        postDataLength: c.postDataLength,
        // 尝试 parse postData
        postDataParsed: (() => {
          try { return JSON.parse(c.postData); } catch { return null; }
        })(),
        responseLength: c.responseLength || c.responseBody?.length || 0,
        responsePreview: c.responseBody?.slice(0, 3000) || null,
        responseParsed: (() => {
          try { return JSON.parse(c.responseBody || ''); } catch { return null; }
        })(),
      })),
      // 所有POST + 报表相关GET (用于事后分析)
      allApiUrls: getAllApiUrls(),
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
    console.log(`📁 已保存: ${OUTPUT_FILE}\n`);

    // Step 6: 关键发现打印
    if (finalCaptures.length > 0) {
      const c = finalCaptures[0];
      console.log('=== 关键发现 ===');
      console.log(`\n[1] POST ${c.url.slice(0, 130)}`);
      console.log(`\n[2] Body (${c.postDataLength} 字节):`);
      if (c.postData) {
        // 美化打印
        try {
          const parsed = JSON.parse(c.postData);
          console.log(JSON.stringify(parsed, null, 2).slice(0, 2000));
        } catch {
          console.log(c.postData.slice(0, 2000));
        }
      }
      console.log(`\n[3] 响应 (${c.responseLength || 0} 字节, 前500):`);
      console.log((c.responseBody || '').slice(0, 500));
    }

    ws.close();
  } finally {
    // Step 6: 关闭 tab
    console.log('\n▶ 关闭 tab...');
    const closed = await closeTab(tabInfo.id);
    console.log(closed ? '✅ Tab 已关闭' : '⚠ Tab 关闭失败');
  }
}

main().catch(e => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});
