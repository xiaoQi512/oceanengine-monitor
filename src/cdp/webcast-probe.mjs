// webcast-probe.mjs - 探测直播分析页「全部直播列表」表格 DOM 结构 (一次性诊断)
import http from 'node:http';
import { createCDPClient } from './client.mjs';

const CDP_HTTP = 'http://127.0.0.1:9222';
const TARGET_URL = 'https://ad.oceanengine.com/statistics_pages/ad_report/operation-analysis/webcast/report?aadvid=1842681352509635';

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // 1. 浏览器端点
  const ver = await httpGetJson(`${CDP_HTTP}/json/version`);
  const browser = await createCDPClient(ver.webSocketDebuggerUrl, { cmdTimeout: 15000 });

  // 2. 新开独立 tab (不打扰投放管理页)
  const created = await browser.call('Target.createTarget', { url: 'about:blank' });
  const targetId = created?.targetId;
  if (!targetId) { console.error('createTarget 失败'); process.exit(1); }
  await sleep(1500);

  // 3. 找到该 target 的页面 ws
  const list = await httpGetJson(`${CDP_HTTP}/json/list`);
  const page = list.find(t => t.id === targetId);
  if (!page) { console.error('未找到新 tab'); process.exit(1); }

  const pageClient = await createCDPClient(page.webSocketDebuggerUrl, { cmdTimeout: 30000 });
  await pageClient.call('Page.navigate', { url: TARGET_URL });
  console.log('已导航到直播分析页, 等待渲染...');

  // 4. 轮询等表格
  let found = false;
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    const probe = await pageClient.call('Runtime.evaluate', {
      expression: `(() => {
        const tables = document.querySelectorAll('table');
        const ths = [...document.querySelectorAll('th')].map(t => t.textContent.trim()).filter(Boolean);
        return JSON.stringify({ url: location.href, title: document.title, tables: tables.length, thCount: ths.length, ths: ths.slice(0, 20) });
      })()`,
      returnByValue: true
    });
    const info = JSON.parse(probe?.result?.value || '{}');
    if (i % 3 === 0) console.log(`[${(i + 1) * 2}s] tables=${info.tables} th=${info.thCount} title=${(info.title || '').slice(0, 40)}`);
    if (info.thCount >= 5) {
      // 等数字填充: 第5列(整体观看数)不能全是 '--'
      const filled = await pageClient.call('Runtime.evaluate', {
        expression: `(() => {
          const tr = document.querySelector('tbody tr');
          const tds = tr ? [...tr.children] : [];
          return tds.length > 4 && tds[4].textContent.trim() !== '--' && tds[4].textContent.trim() !== '';
        })()`,
        returnByValue: true
      });
      if (filled?.result?.value) {
        found = true;
        // dump 表头 + 前 3 行
        const dump = await pageClient.call('Runtime.evaluate', {
          expression: `(() => {
            const ths = [...document.querySelectorAll('th')].map(t => t.textContent.trim());
            const rows = [...document.querySelectorAll('tbody tr')].slice(0, 3).map(tr => [...tr.children].map(td => td.textContent.trim()));
            const iframes = [...document.querySelectorAll('iframe')].map(f => f.src);
            return JSON.stringify({ ths, rows, iframes, rowCount: document.querySelectorAll('tbody tr').length });
          })()`,
          returnByValue: true
        });
        console.log('=== DUMP ===');
        console.log(dump?.result?.value);
        break;
      }
    }
  }
  if (!found) console.log('20轮轮询未找到表格 (可能在 iframe 中)');

  // 5. 关闭 tab
  await browser.call('Target.closeTarget', { targetId });
  console.log('探测完成, tab 已关闭');
  process.exit(0);
}

main().catch(e => { console.error('探测失败:', e.message); process.exit(1); });
