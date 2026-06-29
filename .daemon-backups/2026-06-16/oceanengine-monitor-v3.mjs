// oceanengine-monitor-v3.mjs — 巨量引擎监控 v3 (50条/页 + 按消耗排序 + 全分页 + 所有有消耗计划统计)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawnSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import http from 'node:http';
import {
  getLocalDate, findLarkCli, checkFeedbackServer, guardFeedbackServer,
  loadSuggestionHistory, saveSuggestionHistory, recalcSummary,
  atomicWriteJSON,
  DATA_DIR, REPORT_DIR, HISTORY_FILE, FEEDBACK_PORT, FEISHU_CHAT_ID,
  ACCOUNT_NAME, ACCOUNT_ID, CAMPAIGN_URL, DAILY_BUDGET, DAILY_START_HOUR, DAILY_END_HOUR,
} from './monitor-utils.mjs';

// ====== 日志文件 (所有 console 输出同时写文件) ======
const LOG_FILE = path.join('E:/炼丹炉/WorkBuddy/2026-06-11-08-56-59/monitor-data', 'monitor.log');
const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;
function logToFile(...args) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}
console.log = (...args) => { origLog(...args); logToFile(...args); };
console.error = (...args) => { origError(...args); logToFile('[ERROR]', ...args); };
console.warn = (...args) => { origWarn(...args); logToFile('[WARN]', ...args); };

const CONFIG = {
  accountName: ACCOUNT_NAME,
  accountId: ACCOUNT_ID,
  campaignUrl: CAMPAIGN_URL,
  dataDir: DATA_DIR,
  reportDir: REPORT_DIR,
  pageSize: 50,
  // ====== 投放窗口 ======
  dailyStartHour: DAILY_START_HOUR,
  dailyEndHour: DAILY_END_HOUR,
  dailyBudget: DAILY_BUDGET,
  feedbackPort: FEEDBACK_PORT,
  // ====== 告警阈值 (集中管理，方便调优) ======
  thresholds: {
    speedFast: 1.5,         // 消耗速度涨幅倍数
    speedVeryFast: 2,       // 严重消耗速度涨幅
    cpaRise: 1.2,            // CPA上涨比例
    cpaSevereRise: 1.5,     // 严重CPA上涨
    zeroConvSpend: 50,      // 零转化消耗阈值
    zeroConvSevere: 200,    // 严重零转化阈值
    highCPA_Multiplier: 2.5, // 高CPA倍数
    highCPA_Spend: 30,      // 高CPA最低消耗
    highCPA_SevereSpend: 100, // 高CPA严重消耗
    budgetCap: 0.8,         // 计划预算撞线比例
    budgetWarn: 0.85,       // 日预算预警比例
    budgetDanger: 0.92,     // 日预算危险比例
    pacingFastRatio: 1.5,   // 节奏过快倍数
    pacingSevereRatio: 2,   // 节奏严重倍数
    pacingSlowRatio: 0.6,   // 节奏过慢比例
    pacingSlowMinProgress: 0.3, // 节奏过慢至少需要的时间进度
    dropCountWarn: 3,       // 掉量计划数预警
    dropCountSevere: 5,     // 掉量计划数严重
    trendRampUp: 0.3,       // 起量变化率
    trendDrop: -0.3,        // 掉量变化率
    trendMinDelta: 5,       // 最小增量绝对值
    trendPrevMinSpend: 10,  // 掉量前最低消耗
    suggestExpireMs: 8 * 60 * 60 * 1000, // 建议过期时间 8h
    snapshotMaxAge: 35,     // 快照最大有效分钟
  },
  // ====== 局域网访问 (手机/其他设备访问报表) ======
  get lanIP() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal && (net.address.startsWith('192.168.') || net.address.startsWith('10.'))) {
          return net.address;
        }
      }
    }
    return '127.0.0.1';
  },
  get feedbackBaseUrl() { return `http://${this.lanIP}:${this.feedbackPort}`; },
  // ====== 飞书推送 (lark-cli OAuth 通道) ======
  feishuChatId: FEISHU_CHAT_ID,
  larkCli: findLarkCli(),
};

// ====== 辅助函数 ======
// getLocalDate, findLarkCli, checkFeedbackServer, guardFeedbackServer 等已移入 monitor-utils.mjs

// ====== Chrome 9222 守护 ======
function checkChrome() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:9222/json/version', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { const json = JSON.parse(data); resolve(!!json.Browser); }
        catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function launchChrome() {
  console.log('  🔄 尝试自动拉起 Chrome (9222端口)...');
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  ];
  let chromeExe = '';
  for (const p of chromePaths) {
    if (fs.existsSync(p)) { chromeExe = p; break; }
  }
  if (!chromeExe) {
    console.log('  ⚠ 未找到 Chrome 安装路径，无法自动拉起');
    return false;
  }
  try {
    const userDataDir = process.env.LOCALAPPDATA + '\\Google\\Chrome\\User Data';
    const args = [
      `--remote-debugging-port=9222`,
      `--user-data-dir=${userDataDir}`,
      '--profile-directory=极狐',
      '--no-first-run',
      '--no-default-browser-check',
      CONFIG.campaignUrl,
    ];
    const child = spawn(chromeExe, args, {
      detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.unref();
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      if (await checkChrome()) {
        console.log('  ✅ Chrome 自动拉起成功 (9222端口已就绪)');
        return true;
      }
    }
    console.log('  ⚠ Chrome 启动超时，请手动检查');
    return false;
  } catch (e) {
    console.log(`  ❌ Chrome 启动失败: ${e.message}`);
    return false;
  }
}

// ====== 数据断层标记 ======
function recordDataGap(reason) {
  const today = getLocalDate();
  const logFile = path.join(CONFIG.dataDir, `daily-${today}.json`);
  try {
    let log = [];
    if (fs.existsSync(logFile)) {
      log = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
    }
    log.push({
      time: new Date().toISOString(),
      type: 'data_gap',
      reason: reason,
      activeCount: 0, totalSpend: 0, totalConversions: 0,
      avgCPA: 0, spendLast15min: 0, speedCurrent: 0,
      budgetUsed: 0, rampingUp: 0, dropping: 0,
      alertCount: 0, alertTypes: [],
    });
    atomicWriteJSON(logFile, log);
  } catch {}
}

function readWebhookFile() {
  const whPath = 'E:/炼丹炉/WorkBuddy/2026-06-11-08-56-59/.feishu-webhook';
  try {
    if (fs.existsSync(whPath)) {
      const content = fs.readFileSync(whPath, 'utf-8').trim();
      const firstLine = content.split('\n')[0].trim();
      if (firstLine && firstLine.startsWith('https://open.feishu.cn/open-apis/bot') && firstLine.length > 40) {
        return firstLine;
      }
    }
  } catch {}
  return '';
}

// ====== 建议历史管理 ======
// loadSuggestionHistory / saveSuggestionHistory / recalcSummary 等已移入 monitor-utils.mjs

function recordPendingSuggestions(suggestions) {
  const history = loadSuggestionHistory();
  const now = new Date().toISOString();
  for (const sug of suggestions) {
    // 避免重复
    if (history.suggestions.find(s => s.id === sug.id)) continue;
    history.suggestions.push({
      id: sug.id,
      time: now,
      alertType: sug.alertType,
      campaignId: sug.campaignId || '',
      campaignName: sug.campaignName || '',
      suggestion: sug.suggestion || '',
      response: null,
      responseTime: null,
      timeSlot: sug.timeSlot || '',
    });
  }
  recalcSummary(history);
  saveSuggestionHistory(history);
}

function markIgnoredSuggestions() {
  const history = loadSuggestionHistory();
  let changed = false;
  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  for (const s of history.suggestions) {
    // 超过8小时未回复且是今天的 → 标记忽略
    if (!s.response) {
      const sugTime = new Date(s.time).getTime();
      const elapsed = Date.now() - sugTime;
      if (elapsed > 8 * 60 * 60 * 1000 && sugTime > yesterday) {
        s.response = 'ignored';
        s.responseTime = new Date().toISOString();
        changed = true;
      }
    }
  }
  if (changed) {
    recalcSummary(history);
    saveSuggestionHistory(history);
  }
}

// ====== suggestion suppression / dedup logic ======
// 去重策略: 全局类型级抑制 + 计划级去重(所有actionable类型) + 2h窗口去重
const ACTIONABLE_TYPES = ['zero_conv', 'high_cpa', 'budget_cap'];

function shouldSuggest(alertType, campaignId, history) {
  if (!history || !history.summary) return { suggest: true, reason: '' };
  const stats = history.summary.byType[alertType];
  if (!stats) return { suggest: true, reason: '' };
  
  // 全局类型级抑制: 该类型被拒≥2次且采纳0次 → 降级
  if (stats.rejected >= 2 && stats.accepted === 0) {
    return { suggest: false, reason: `历史中该类型建议被拒绝${stats.rejected}次，已自动抑制` };
  }
  
  // 计划级去重: 覆盖所有 actionable 类型 (zero_conv / high_cpa / budget_cap)
  if (ACTIONABLE_TYPES.includes(alertType) && campaignId) {
    // 规则1: 该计划此类型曾被拒绝 → 不再建议
    const campaignRejects = history.suggestions.filter(
      s => s.campaignId === campaignId && s.alertType === alertType && s.response === 'reject'
    );
    if (campaignRejects.length > 0) {
      return { suggest: false, reason: `该计划此前此类建议已被拒绝，已自动抑制` };
    }
    
    // 规则2: 2小时内同计划同类型已有待处理建议 → 抑制重复轰炸
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const pendingSame = history.suggestions.filter(
      s => s.campaignId === campaignId
        && s.alertType === alertType
        && !s.response
        && new Date(s.time).getTime() > twoHoursAgo
    );
    if (pendingSame.length > 0) {
      return { suggest: false, reason: `该计划2h内已有待处理同类建议，不重复推送` };
    }
  }
  
  return { suggest: true, reason: '' };
}

// 生成建议摘要（用于卡片和日志）
function getSuggestionInsight(history) {
  if (!history || history.suggestions.length === 0) return '';
  const s = history.summary;
  const acceptRate = s.totalSuggestions > 0 ? (s.accepted / (s.accepted + s.rejected) * 100).toFixed(0) : '—';
  return `📋 建议采纳率: ${acceptRate}% (采纳${s.accepted}/拒绝${s.rejected}/忽略${s.ignored})`;
}

// ====== CDP ======
async function connect(address) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(address);
    let cmdId = 1;
    const pending = new Map();
    ws.onopen = () => resolve({ ws, send, close: () => ws.close() });
    ws.onerror = (e) => reject(e);
    ws.onmessage = (evt) => {
      const d = (typeof evt === 'string' ? evt : (evt.data || '')).toString();
      let msg; try { msg = JSON.parse(d); } catch { return; }
      if (msg.id && pending.has(msg.id)) { const { r } = pending.get(msg.id); pending.delete(msg.id); r(msg); }
    };
    function send(method, params = {}, timeoutMs = 30000) {
      return new Promise((resolve) => {
        const id = cmdId++;
        pending.set(id, { r: resolve });
        try { ws.send(JSON.stringify({ id, method, params })); } catch(e) { resolve(null); }
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, timeoutMs);
      });
    }
  });
}

async function getTab(titlePattern) {
  const resp = await fetch('http://localhost:9222/json/list');
  const tabs = await resp.json();
  if (titlePattern) return tabs.find(t => t.title?.includes(titlePattern));
  return tabs.find(t => t.url?.includes('oceanengine.com')) || tabs[0];
}

async function closePopups(client) {
  const r = await client.send('Runtime.evaluate', {
    expression: `(()=>{let r=[];document.querySelectorAll('*').forEach(e=>{let t=e.textContent?.trim();if(t==='立即体验'||t==='我知道了'||t==='知道了'||t==='升级'&&e.tagName==='BUTTON'){e.click();r.push(t)}});return JSON.stringify(r)})()`,
    returnByValue: true, awaitPromise: false,
  });
}

// ====== 设置每页显示条数 ======
async function setPageSize(client, size = 50) {
  console.log(`  设置每页${size}条...`);
  
  // 1. 检查当前是否已是目标值
  const r0 = await client.send('Runtime.evaluate', {
    expression: `document.querySelector('.ovui-page-select input')?.value`,
    returnByValue: true
  });
  const current = r0?.result?.result?.value;
  if (current === `${size}条/页`) {
    console.log(`  已是${size}条/页，跳过`);
    return true;
  }
  
  // 2. 打开下拉：用 PointerEvent 点击 select 容器
  await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const sel = document.querySelector('.ovui-page-select .ovui-select');
      if (sel) {
        sel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        sel.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
        sel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    })()`,
    returnByValue: true
  });
  await sleep(1500);
  
  // 3. 检查下拉是否打开
  const r1 = await client.send('Runtime.evaluate', {
    expression: `!!document.querySelector('.ovui-select__popper--show')`,
    returnByValue: true
  });
  
  if (!r1?.result?.result?.value) {
    console.log('  下拉未打开，重试...');
    await client.send('Runtime.evaluate', {
      expression: `document.querySelector('.ovui-page-select .ovui-select')?.click()`,
      returnByValue: true
    });
    await sleep(1500);
  }
  
  // 4. 点击目标选项
  const r2 = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const opts = document.querySelectorAll('.ovui-select__popper--show .ovui-option');
      for (const opt of opts) {
        if (opt.textContent?.trim() === '${size}条/页') {
          opt.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
          opt.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
          opt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return JSON.stringify({ clicked: true, text: opt.textContent?.trim() });
        }
      }
      return JSON.stringify({ clicked: false, optionsFound: opts.length });
    })()`,
    returnByValue: true
  });
  
  const clickResult = JSON.parse(r2?.result?.result?.value || '{}');
  console.log(`  点击结果: ${clickResult.clicked ? '成功' : '失败'} (${clickResult.text || clickResult.optionsFound + '个选项'})`);
  
  await sleep(2000);
  
  // 5. 验证
  const r3 = await client.send('Runtime.evaluate', {
    expression: `document.querySelector('.ovui-page-select input')?.value`,
    returnByValue: true
  });
  const newVal = r3?.result?.result?.value;
  console.log(`  当前每页: ${newVal}`);
  
  return newVal === `${size}条/页`;
}

// ====== 按消耗降序排序（倒序：高消耗在前） ======
// OVUI排序图标: sorter-up ▲ (正序升序) | sorter-down ▼ (倒序降序)
// 激活态: --active 后缀, 如 sorter-down--active
async function sortBySpend(client) {
  console.log('  按消耗降序排序 (倒序)...');
  
  // 1. 检查当前排序状态
  const r0 = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const headers = document.querySelectorAll('th');
      for (const th of headers) {
        const t = th.textContent?.trim();
        if (t === '消耗' || t === '消耗(元)' || t.includes('消耗(')) {
          const sorterDown = th.querySelector('.ovui-th__sorter-down');
          const sorterUp = th.querySelector('.ovui-th__sorter-up');
          
          const downActive = sorterDown?.className?.includes('--active') || false;
          const upActive = sorterUp?.className?.includes('--active') || false;
          
          // 获取两个图标的完整类名
          return JSON.stringify({
            found: true, colText: t,
            downActive: !!downActive,
            upActive: !!upActive,
            downCls: sorterDown?.className?.toString()?.slice(0, 80) || 'null',
            upCls: sorterUp?.className?.toString()?.slice(0, 80) || 'null',
            noSort: !downActive && !upActive,
          });
        }
      }
      return JSON.stringify({ found: false });
    })()`,
    returnByValue: true
  });
  
  const state = JSON.parse(r0?.result?.result?.value || '{"found":false}');
  console.log(`  排序状态: ${state.found ? '↓激活='+state.downActive+' ↑激活='+state.upActive+' 无排序='+state.noSort : '未找到消耗列'}`);
  
  // 已经是降序 → 直接返回
  if (state.downActive) {
    console.log('  已是降序(倒序)，无需切换');
    return;
  }
  
  // 2. OVUI排序状态机: 无排序→升序(↑)→降序(↓)→无排序→...
  //    当前升序 → 需切换到降序。点击父容器 .ovui-th__column-sorter 触发状态机
  //    因为直接点子图标可能不走 React 事件代理
  const r1 = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const headers = document.querySelectorAll('th');
      for (const th of headers) {
        if ((th.textContent?.trim()||'').includes('消耗')) {
          // 找到 column-sorter 父容器（OVUI 在此绑定了排序切换事件）
          const sorter = th.querySelector('.ovui-th__column-sorter');
          if (sorter) {
            // 用 PointerEvent 完整序列触发
            const rect = sorter.getBoundingClientRect();
            const cx = rect.x + rect.width / 2;
            const cy = rect.y + rect.height / 2;
            
            sorter.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
            sorter.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
            sorter.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
            
            // 等 React 更新后再检查
            return JSON.stringify({ clicked: true, target: 'column-sorter', rect: { x: Math.round(rect.x), y: Math.round(rect.y) } });
          }
          return JSON.stringify({ clicked: false, reason: 'no column-sorter', thHas: th.querySelector('.ovui-th__sorter') ? 'sorter' : 'none' });
        }
      }
      return JSON.stringify({ clicked: false, reason: 'no spend column' });
    })()`,
    returnByValue: true
  });
  
  const clickResult = JSON.parse(r1?.result?.result?.value || '{clicked:false}');
  console.log(`  排序点击: ${clickResult.clicked ? '✅已触发 column-sorter @ ('+clickResult.rect?.x+','+clickResult.rect?.y+')' : '❌'+clickResult.reason}`);
  
  await sleep(2500);
  
  // 3. 验证是否已降到降序
  const r2 = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const headers = document.querySelectorAll('th');
      for (const th of headers) {
        if ((th.textContent?.trim()||'').includes('消耗')) {
          const down = th.querySelector('.ovui-th__sorter-down');
          return JSON.stringify({ downActive: !!(down?.className?.includes('--active')) });
        }
      }
      return JSON.stringify({ error: 'not found' });
    })()`,
    returnByValue: true
  });
  const verify = JSON.parse(r2?.result?.result?.value || '{"error":true}');
  console.log(`  排序验证: ${verify.downActive ? '✅降序(倒序)' : '❌未降序，继续尝试...'}`);
  
  if (!verify.downActive) {
    // 回退方案：先点 sorter-down（如果升序激活中，点了会变成无排序），再点一次
    console.log('  回退: 点sorter-down两次...');
    for (let i = 0; i < 2; i++) {
      await client.send('Runtime.evaluate', {
        expression: `(()=>{
          const headers = document.querySelectorAll('th');
          for (const th of headers) {
            if ((th.textContent?.trim()||'').includes('消耗')) {
              const down = th.querySelector('.ovui-th__sorter-down');
              if (down) { down.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 'clicked'; }
            }
          }
        })()`,
        returnByValue: true
      });
      await sleep(1500);
    }
  }
  
  await sleep(2000); // 等排序完成 + 数据渲染
}

// ====== 单页数据抓取 ======
async function scrapeOnePage(client) {
  const r = await client.send('Runtime.evaluate', {
    expression: `
      (() => {
        const campaigns = [];
        const tbodyRows = document.querySelectorAll('tbody tr');
        
        for (const row of tbodyRows) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 10) continue;
          
          const data = Array.from(cells).map(c => c.textContent?.trim() || '');
          
          // 解析名称和ID
          const nameCell = data[1] || '';
          const lines = nameCell.split(/\\n/).filter(s => s.trim());
          let projectName = lines[0] || nameCell;
          let projectId = '';
          for (const line of lines) {
            const m = line.match(/ID[:：]\\s*(\\d+)/);
            if (m) { projectId = m[1]; projectName = lines[0].replace(/\\s*ID[:：].*$/, '').trim(); break; }
          }
          if (!projectId) {
            for (const line of lines) { if (/^\\d{15,}$/.test(line.trim())) { projectId = line.trim(); break; } }
          }
          
          campaigns.push({
            name: projectName.substring(0, 80),
            id: projectId,
            status: data[4] || '',
            budget: data[5] || '',
            bid: data[6] || '',
            spend: parseFloat((data[7] || '0').replace(/,/g, '')) || 0,
            leads: parseInt(data[8] || '0') || 0,
            conversions: parseInt(data[9] || '0') || 0,
            privateMsgOpen: parseInt(data[10] || '0') || 0,
            privateMsgRetain: parseInt(data[11] || '0') || 0,
            formSubmit: parseInt(data[12] || '0') || 0,
            ctr: parseFloat((data[13] || '0%').replace('%', '')) / 100 || 0,
            cpm: parseFloat((data[14] || '0').replace(/,/g, '')) || 0,
            cvr: parseFloat((data[15] || '0%').replace('%', '')) / 100 || 0,
            liveViews: parseInt(data[16] || '0') || 0,
            liveOver1Min: parseInt(data[17] || '0') || 0,
            liveComments: parseInt(data[18] || '0') || 0,
            componentCost: parseFloat((data[19] || '0').replace(/,/g, '')) || 0,
            dislike: parseInt(data[20] || '0') || 0,
            report: parseInt(data[21] || '0') || 0,
          });
          // 自纠错：部分计划类型的列16/17顺序不一致，若 >1min > 总观看则交换
          if (campaigns[campaigns.length-1].liveOver1Min > campaigns[campaigns.length-1].liveViews) {
            const tmp = campaigns[campaigns.length-1].liveViews;
            campaigns[campaigns.length-1].liveViews = campaigns[campaigns.length-1].liveOver1Min;
            campaigns[campaigns.length-1].liveOver1Min = tmp;
          }
        }
        
        // CPA
        for (const c of campaigns) { c.cpa = c.conversions > 0 ? c.spend / c.conversions : 0; }
        
        // ====== 抓取账户级日预算和日消耗 (页面顶部工具栏) ======
        let accountBudget = 0;
        let accountSpend = 0;
        let accountBalance = 0;
        
        // 策略1: 从 oc-promotion-tool-bar 组件精准提取
        const toolbar = document.querySelector('.oc-promotion-tool-bar');
        if (toolbar) {
          const kvPairs = toolbar.querySelectorAll('.oc-promotion-tool-bar-key-value');
          for (const kv of kvPairs) {
            const spans = kv.querySelectorAll('span');
            const label = spans[0]?.textContent?.trim() || '';
            // 值在 span 序列中的第4个位置 (index 3)
            const valStr = spans[3]?.textContent?.trim() || '';
            const val = parseFloat(valStr.replace(/,/g, '')) || 0;
            if (label.includes('日消耗')) accountSpend = val;
            else if (label.includes('日预算')) accountBudget = val;
            else if (label.includes('账户余额')) accountBalance = val;
          }
        }
        
        // 策略2: 正则匹配 (降级)
        if (accountBudget === 0 && accountSpend === 0) {
          const toolbarText = toolbar?.textContent || document.body.innerText;
          const bMatch = toolbarText.match(/日预算[（(]元[)）]([\\d,]+\\.?\\d*)/);
          const sMatch = toolbarText.match(/日消耗[（(]元[)）]([\\d,]+\\.?\\d*)/);
          if (bMatch) accountBudget = parseFloat(bMatch[1].replace(/,/g, '')) || 0;
          if (sMatch) accountSpend = parseFloat(sMatch[1].replace(/,/g, '')) || 0;
        }
        
        // ====== 抓取页面顶部汇总行 (ovui-t-summary) ======
        // 巨量引擎的汇总行在表头下方、数据上方，class="ovui-t-summary"
        let pageSummary = null;
        try {
          const summaryRows = document.querySelectorAll('tr.ovui-t-summary');
          if (summaryRows.length > 0) {
            const sumCells = summaryRows[0].querySelectorAll('th, td');
            const sumData = Array.from(sumCells).map(c => c.textContent?.trim() || '');
            // sumData 结构（来自实际探测）:
            // [0]="" [1]="总计 178 项" [2-5]="" [6]=消耗 [7]=线索数 [8]=转化数 [9]=私信开口 [10]=私信留资 [11]=表单提交 ...
            const parseNum = (s) => parseFloat((s||'0').replace(/,/g,'')) || 0;
            pageSummary = {
              spend:           parseNum(sumData[7]),
              leads:           parseInt(sumData[8]) || 0,
              conversions:     parseInt(sumData[9]) || 0,
              privateMsgOpen:  parseInt(sumData[10]) || 0,
              privateMsgRetain: parseInt(sumData[11]) || 0,
              formSubmit:      parseInt(sumData[12]) || 0,
              cpm:             parseNum(sumData[14]),       // 汇总行CPM (与 detail[14] 同列偏移)
              liveViews:       parseInt((sumData[16]||'0').replace(/,/g,'')) || 0,
              liveOver1Min:    parseInt((sumData[17]||'0').replace(/,/g,'')) || 0,
            };
          }
        } catch(e) {
          // 忽略汇总行提取失败，不影响主抓取
        }
        
        return JSON.stringify({
          campaigns, count: campaigns.length, time: new Date().toISOString(),
          accountBudget, accountSpend, accountBalance,
          pageSummary,
        });
      })()
    `,
    returnByValue: true
  });
  const result = JSON.parse(r?.result?.result?.value || '{"campaigns":[]}');
  return {
    campaigns: result.campaigns || [],
    accountBudget: result.accountBudget || 0,
    accountSpend: result.accountSpend || 0,
    accountBalance: result.accountBalance || 0,
    pageSummary: result.pageSummary || null,
  };
}

// 解析计划预算字符串 "10,000.00按日预算" → 10000
function parsePlanBudget(budgetStr) {
  if (!budgetStr) return 0;
  const m = budgetStr.match(/[\d,]+\.?\d*/);
  if (!m) return 0;
  return parseFloat(m[0].replace(/,/g, '')) || 0;
}

// ====== 数据分析 ======

// 加载历史快照（T-15min, T-30min, T-60min）
function loadPreviousSnapshots() {
  const result = { t15: null, t30: null, t60: null };
  try {
    const files = fs.readdirSync(CONFIG.dataDir)
      .filter(f => f.endsWith('.json') && f.startsWith('202'))
      .map(f => ({ name: f }))
      .sort((a, b) => b.name.localeCompare(a.name)); // 文件名即时间戳，比 mtime 可靠

    if (files.length < 1) return result;

    // T-15: 最新的历史文件（当前这次运行还没保存，所以最新的就是上一次）
    result.t15 = readSnapshot(files[0].name);
    if (result.t15) result.t15._ageMinutes = (Date.now() - parseSnapshotTime(files[0].name)) / 60000;

    // T-30: 大约倒数第2个
    if (files.length >= 2) {
      result.t30 = readSnapshot(files[1].name);
      if (result.t30) result.t30._ageMinutes = (Date.now() - parseSnapshotTime(files[1].name)) / 60000;
    }

    // T-60: 大约倒数第4个
    if (files.length >= 4) {
      result.t60 = readSnapshot(files[3].name);
      if (result.t60) result.t60._ageMinutes = (Date.now() - parseSnapshotTime(files[3].name)) / 60000;
    }
    else if (files.length >= 3) {
      result.t60 = readSnapshot(files[2].name);
      if (result.t60) result.t60._ageMinutes = (Date.now() - parseSnapshotTime(files[2].name)) / 60000;
    }

  } catch (e) {
    console.log(`  加载历史快照异常: ${e.message}`);
  }
  return result;
}

function readSnapshot(filename) {
  try {
    const raw = fs.readFileSync(path.join(CONFIG.dataDir, filename), 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

// 从快照文件名解析时间戳 (格式: 2026-06-14T14-15-00.json)
function parseSnapshotTime(filename) {
  try {
    const ts = filename.replace('.json', '').replace('T', ' ').replace(/-/g, (m, i) => i >= 10 ? ':' : m);
    return new Date(ts + 'Z').getTime(); // +Z: 文件名用 toISOString() (UTC)，必须按 UTC 解析
  } catch { return 0; }
}

// 构建 campaign id → campaign 的索引
function buildCampaignIndex(campaigns) {
  const map = new Map();
  for (const c of campaigns) {
    map.set(c.id, c);
  }
  return map;
}

// ====== 滑动窗口趋势检测 (线性回归斜率) ======
function computeLinearSlope(series) {
  // series: [{x: 0, y: 100}, {x: 1, y: 105}, ...]
  const n = series.length;
  if (n < 3) return 0; // 至少3个点
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of series) {
    sumX += p.x; sumY += p.y;
    sumXY += p.x * p.y; sumX2 += p.x * p.x;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function detectTrends() {
  const today = getLocalDate();
  const logFile = path.join(CONFIG.dataDir, `daily-${today}.json`);
  if (!fs.existsSync(logFile)) return { cpaTrend: null, spendTrend: null };
  
  let log;
  try { log = JSON.parse(fs.readFileSync(logFile, 'utf-8')); } catch { return { cpaTrend: null, spendTrend: null }; }
  if (!log || log.length < 3) return { cpaTrend: null, spendTrend: null };
  
  // 取最近8个周期
  const recent = log.slice(-8);
  const cpaSeries = recent.map((e, i) => ({ x: i, y: e.avgCPA || 0 })).filter(p => p.y > 0);
  const spendSeries = recent.map((e, i) => ({ x: i, y: e.speedCurrent || 0 }));
  
  const cpaSlope = computeLinearSlope(cpaSeries);
  const spendSlope = computeLinearSlope(spendSeries);
  
  // 计算相对于均值的日化变化率
  const avgCPA = cpaSeries.length > 0 ? cpaSeries.reduce((s, p) => s + p.y, 0) / cpaSeries.length : 0;
  const avgSpeed = spendSeries.length > 0 ? spendSeries.reduce((s, p) => s + p.y, 0) / spendSeries.length : 0;
  
  const cpaChangeRate = avgCPA > 0 ? (cpaSlope * 7) / avgCPA : 0; // 7周期≈105min的趋势外推
  const spendChangeRate = avgSpeed > 0 ? (spendSlope * 7) / avgSpeed : 0;
  
  return {
    cpaTrend: cpaSeries.length >= 3 ? { slope: cpaSlope, changeRate: cpaChangeRate, periods: cpaSeries.length } : null,
    spendTrend: spendSeries.length >= 3 ? { slope: spendSlope, changeRate: spendChangeRate, periods: spendSeries.length } : null,
  };
}

// ====== 同比基线 (vs 昨天同时段) ======
function loadYesterdayBaseline() {
  const now = new Date();
  const today = getLocalDate(now);
  const yesterday = getLocalDate(new Date(now - 24 * 60 * 60 * 1000));
  const logFile = path.join(CONFIG.dataDir, `daily-${yesterday}.json`);
  if (!fs.existsSync(logFile)) return null;
  
  let log;
  try { log = JSON.parse(fs.readFileSync(logFile, 'utf-8')); } catch { return null; }
  if (!log || log.length === 0) return null;
  
  // 找到最接近当前时间的昨天条目
  const currentHour = now.getHours() + now.getMinutes() / 60;
  let best = null;
  let bestDiff = Infinity;
  for (const entry of log) {
    const t = new Date(entry.time);
    const h = t.getHours() + t.getMinutes() / 60;
    const diff = Math.abs(h - currentHour);
    if (diff < bestDiff) { bestDiff = diff; best = entry; }
  }
  
  if (!best || bestDiff > 2) return null; // 超过2小时差距不算
  
  return {
    time: best.time,
    totalSpend: best.accountSpend > 0 ? best.accountSpend : (best.totalSpend || 0),
    totalConversions: best.totalConversions || 0,
    avgCPA: best.avgCPA || 0,
    activeCount: best.activeCount || 0,
    timeDiff: bestDiff,
    date: yesterday,
  };
}

// ====== 多日基线 (近N天同时段均值 + 标准差) ======
function loadMultiDayBaseline(days = 3) {
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const hourlyEntries = [];

  for (let d = 1; d <= days; d++) {
    const dateStr = getLocalDate(new Date(now - d * 24 * 60 * 60 * 1000));
    const logFile = path.join(CONFIG.dataDir, `daily-${dateStr}.json`);
    if (!fs.existsSync(logFile)) continue;

    let log;
    try { log = JSON.parse(fs.readFileSync(logFile, 'utf-8')); } catch { continue; }
    if (!log || log.length < 3) continue;

    // 找最接近当前时间的条目（±1h窗口内）
    let best = null, bestDiff = Infinity;
    for (const entry of log) {
      const t = new Date(entry.time);
      const h = t.getHours() + t.getMinutes() / 60;
      const diff = Math.abs(h - currentHour);
      if (diff < bestDiff && diff <= 2) { bestDiff = diff; best = entry; }
    }
    if (best) {
      hourlyEntries.push({
        date: dateStr,
        spend: best.accountSpend > 0 ? best.accountSpend : (best.totalSpend || 0),
        conversions: best.totalConversions || 0,
        cpa: best.avgCPA || 0,
        speed: best.speedCurrent || 0,
        activeCount: best.activeCount || 0,
        leads: best.totalLeads || 0,
        openRetainRate: best.openRetainRate || 0,
        avgCPM: best.avgCPM || 0,
        viewRetention: best.viewRetention || 0,
        convEfficiency: best.convEfficiency || 0,
        timeDiff: bestDiff,
      });
    }
  }

  if (hourlyEntries.length < 2) return null;

  const spendVals = hourlyEntries.map(e => e.spend);
  const cpaVals = hourlyEntries.map(e => e.cpa).filter(v => v > 0);
  const speedVals = hourlyEntries.map(e => e.speed).filter(v => v > 0);
  const convVals = hourlyEntries.map(e => e.conversions);
  const activeVals = hourlyEntries.map(e => e.activeCount);
  const retainVals = hourlyEntries.map(e => e.openRetainRate).filter(v => v > 0);
  const cpmVals = hourlyEntries.map(e => e.avgCPM).filter(v => v > 0);
  const viewRetVals = hourlyEntries.map(e => e.viewRetention).filter(v => v > 0);
  const convEffVals = hourlyEntries.map(e => e.convEfficiency).filter(v => v > 0);

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const stdev = arr => {
    if (arr.length < 2) return 0;
    const m = avg(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
  };

  return {
    entries: hourlyEntries,
    spend: { mean: avg(spendVals), stdev: stdev(spendVals), min: Math.min(...spendVals), max: Math.max(...spendVals) },
    cpa: cpaVals.length ? { mean: avg(cpaVals), stdev: stdev(cpaVals), min: Math.min(...cpaVals), max: Math.max(...cpaVals) } : null,
    speed: speedVals.length ? { mean: avg(speedVals), stdev: stdev(speedVals), min: Math.min(...speedVals), max: Math.max(...speedVals) } : null,
    conversions: { mean: avg(convVals), min: Math.min(...convVals), max: Math.max(...convVals) },
    activeCount: activeVals.length ? { mean: avg(activeVals), min: Math.min(...activeVals), max: Math.max(...activeVals) } : null,
    openRetainRate: retainVals.length ? { mean: avg(retainVals), stdev: stdev(retainVals) } : null,
    cpm: cpmVals.length ? { mean: avg(cpmVals), stdev: stdev(cpmVals) } : null,
    viewRetention: viewRetVals.length ? { mean: avg(viewRetVals), stdev: stdev(viewRetVals) } : null,
    convEfficiency: convEffVals.length ? { mean: avg(convEffVals), stdev: stdev(convEffVals) } : null,
    sampleDays: hourlyEntries.length,
  };
}

// ====== 3小时窗口分析 (从今日 daily JSON 追溯近3h趋势) ======
function analyze3HourWindow() {
  const today = getLocalDate();
  const logFile = path.join(CONFIG.dataDir, `daily-${today}.json`);
  if (!fs.existsSync(logFile)) return null;

  let log;
  try { log = JSON.parse(fs.readFileSync(logFile, 'utf-8')); } catch { return null; }
  if (!log || log.length < 3) return null;

  const now = Date.now();
  // 取最近3小时(180分钟)内的条目
  const recent = log.filter(e => {
    const t = new Date(e.time).getTime();
    return (now - t) <= 180 * 60 * 1000;
  });

  if (recent.length < 2) return null;

  // 分成前半(较旧)和后半(较新)对比
  const mid = Math.floor(recent.length / 2);
  const firstHalf = recent.slice(0, mid);
  const secondHalf = recent.slice(mid);

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const sum = arr => arr.reduce((a, b) => a + b, 0);

  const firstSpendTotal = sum(firstHalf.map(e => e.totalSpend || 0));
  const secondSpendTotal = sum(secondHalf.map(e => e.totalSpend || 0));
  const firstSpeedAvg = avg(firstHalf.map(e => e.speedCurrent || 0));
  const secondSpeedAvg = avg(secondHalf.map(e => e.speedCurrent || 0));
  const firstCPA = avg(firstHalf.map(e => e.avgCPA || 0).filter(v => v > 0));
  const secondCPA = avg(secondHalf.map(e => e.avgCPA || 0).filter(v => v > 0));

  // 计算变化幅度
  const speedChange = firstSpeedAvg > 0 ? (secondSpeedAvg - firstSpeedAvg) / firstSpeedAvg : 0;
  const cpaChange = firstCPA > 0 ? (secondCPA - firstCPA) / firstCPA : 0;

  // 3h 内转化率趋势
  const firstConv = sum(firstHalf.map(e => e.totalConversions || 0));
  const secondConv = sum(secondHalf.map(e => e.totalConversions || 0));
  const firstConvRate = firstSpendTotal > 0 ? firstConv / firstSpendTotal * 1000 : 0;
  const secondConvRate = secondSpendTotal > 0 ? secondConv / secondSpendTotal * 1000 : 0;
  const convRateChange = firstConvRate > 0 ? (secondConvRate - firstConvRate) / firstConvRate : 0;

  // 消耗加速率（小时环比）
  const hours = Math.max((now - new Date(recent[0].time).getTime()) / 3600000, 0.5);
  const burnRate = secondSpendTotal / (hours / 2); // 后半段的均速 (元/小时)
  const firstBurnRate = firstSpendTotal / (hours / 2);

  return {
    sampleCount: recent.length,
    windowHours: hours.toFixed(1),
    // 速度
    speed: { first: firstSpeedAvg, second: secondSpeedAvg, change: speedChange },
    // CPA
    cpa: { first: firstCPA || 0, second: secondCPA || 0, change: cpaChange },
    // 消耗量
    spend: { first: firstSpendTotal, second: secondSpendTotal, change: firstSpendTotal > 0 ? (secondSpendTotal - firstSpendTotal) / firstSpendTotal : 0 },
    // 转化率 (每千元消耗)
    convRate: { first: firstConvRate, second: secondConvRate, change: convRateChange },
    // 燃烧速度
    burnRate: { first: firstBurnRate, second: burnRate, change: firstBurnRate > 0 ? (burnRate - firstBurnRate) / firstBurnRate : 0 },
    // 转化数
    conversions: { first: firstConv, second: secondConv },
  };
}
// ====== 计划生命周期追踪 ======
const LIFECYCLE_FILE = path.join(CONFIG.dataDir, 'campaign-lifecycle.json');
const LIFECYCLE_STAGES = {
  cold_start: { label: '冷启动', emoji: '🌱', maxPeriods: 6 },
  active: { label: '活跃', emoji: '🔥', maxPeriods: Infinity },
  declining: { label: '衰退', emoji: '📉', maxPeriods: Infinity },
  dead: { label: '疑似死亡', emoji: '💀', maxPeriods: Infinity },
};

function loadCampaignLifecycle() {
  try {
    if (fs.existsSync(LIFECYCLE_FILE)) return JSON.parse(fs.readFileSync(LIFECYCLE_FILE, 'utf-8'));
  } catch {}
  return { campaigns: {}, lastUpdate: null };
}

function saveCampaignLifecycle(lc) {
  try { fs.writeFileSync(LIFECYCLE_FILE, JSON.stringify(lc, null, 2)); } catch {}
}

function updateCampaignLifecycle(campaigns) {
  const lc = loadCampaignLifecycle();
  const now = new Date().toISOString();
  let changed = false;
  let dirty = false;  // dirty: 任何字段变更(含lastActive)均需持久化

  for (const c of campaigns) {
    if (!c.id || c.id === 'unknown') continue;
    let record = lc.campaigns[c.id];

    if (!record) {
      // 新计划: 标记为冷启动
      record = { name: c.name, firstSeen: now, lastActive: now, consecutiveLowSpend: 0, stage: 'cold_start', stageSince: now };
      lc.campaigns[c.id] = record;
      changed = true;
      dirty = true;
    }

    // 始终更新 lastActive 并标记 dirty
    if (record.lastActive !== now) { record.lastActive = now; dirty = true; }

    // 更新连续低消耗周期数
    if (c.spend < 5) {
      record.consecutiveLowSpend = (record.consecutiveLowSpend || 0) + 1;
      dirty = true;
    } else {
      if (record.consecutiveLowSpend !== 0) { record.consecutiveLowSpend = 0; dirty = true; }
    }

    // 生命周期阶段判定
    const firstSeenTime = new Date(record.firstSeen).getTime();
    const nowTime = Date.now();
    const msSinceFirst = nowTime - firstSeenTime;
    const periodsActive = Math.floor(msSinceFirst / (15 * 60 * 1000));

    // 冷启动超过6小时且无消耗 → 标记死
    if (record.stage === 'cold_start' && periodsActive >= 24 && c.spend < 5) {
      record.stage = 'dead';
      record.stageSince = now;
      changed = true; dirty = true;
    }
  }

  lc.lastUpdate = now;
  if (dirty) saveCampaignLifecycle(lc);
  return lc;
}

function getCampaignLifecycleStage(campaignId) {
  const lc = loadCampaignLifecycle();
  const record = lc.campaigns[campaignId];
  return record ? record.stage : 'unknown';
}

// ====== 智能分页 ======
async function hasNextPage(client) {
  const r = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const nextBtn = document.querySelector('.ovui-pagination__next');
      if (!nextBtn) return JSON.stringify({ hasNext: false, reason: 'no next button' });
      const isDisabled = nextBtn.classList.contains('disabled') || nextBtn.getAttribute('aria-disabled') === 'true';
      return JSON.stringify({ hasNext: !isDisabled, disabled: isDisabled });
    })()`,
    returnByValue: true
  });
  try { const v = JSON.parse(r?.result?.result?.value || '{}'); return v.hasNext || false; } catch { return false; }
}

async function clickNextPage(client) {
  const r = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const nextBtn = document.querySelector('.ovui-pagination__next');
      if (nextBtn && !nextBtn.classList.contains('disabled')) {
        nextBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        nextBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
        nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return JSON.stringify({ clicked: true });
      }
      return JSON.stringify({ clicked: false });
    })()`,
    returnByValue: true
  });
  await sleep(3000); // 等新页加载
  return true;
}

function analyzeData(campaigns, accountSpend = 0, accountBudget = 0, accountBalance = 0, pageSummary = null) {
  // ====== 计划分类 ======
  // allSpending: 所有有消耗的计划（含投放中/已暂停/超出预算），用于总量统计
  const allSpending = campaigns.filter(c => c.spend > 0);
  // active: 仅投放中的计划，用于趋势分析和告警（已暂停的计划无法执行操作）
  const active = allSpending.filter(c =>
    c.status.includes('启用中') || c.status.includes('投放中')
  );

  // ====== 状态分布统计 ======
  const statusDist = {};
  for (const c of allSpending) {
    const s = c.status || '未知';
    statusDist[s] = (statusDist[s] || 0) + 1;
  }
  // 标准化状态标签
  const statusLabels = Object.keys(statusDist).map(s => {
    if (s.includes('超出预算')) return { label: '未投放(超出预算)', count: statusDist[s] };
    if (s.includes('暂停')) return { label: '未投放(已暂停)', count: statusDist[s] };
    if (s.includes('启用中') || s.includes('投放中')) return { label: '投放中', count: statusDist[s] };
    return { label: s, count: statusDist[s] };
  });

  // 总消耗优先级: 账户日消耗 > 所有有消耗计划(含暂停)之和 > 仅活跃计划之和
  const hasAccountData = accountBudget > 0;
  const validAccountSpend = hasAccountData ? accountSpend : null;
  const allSpendSum = allSpending.reduce((s, c) => s + c.spend, 0);
  const activeSpendSum = active.reduce((s, c) => s + c.spend, 0);
  let totalSpend = validAccountSpend !== null ? validAccountSpend : (allSpendSum > 0 ? allSpendSum : activeSpendSum);
  const useAccountSpend = validAccountSpend !== null;
  const spendSource = useAccountSpend ? 'account' : (allSpendSum > activeSpendSum ? 'all_plans' : 'active_only');

  // ====== 基础汇总 (使用所有有消耗计划，不只是投放中) ======
  const effectiveBudget = accountBudget > 0 ? accountBudget : CONFIG.dailyBudget;

  if (allSpending.length === 0 && !useAccountSpend) return {
    active: [], allSpending: [], paused: 0, alerts: [],
    summary: { totalActive: 0, totalSpending: 0, totalSpend: 0, totalConversions: 0, avgCPA: 0, avgCTR: 0, avgCVR: 0, avgCPM: 0,
      totalLeads: 0, totalPrivateMsgOpen: 0, totalPrivateMsgRetain: 0, totalFormSubmit: 0, openRetainRate: 0,
      accountSpend: accountBudget > 0 ? accountSpend : null, accountBudget: accountBudget > 0 ? accountBudget : null,
      useAccountSpend: accountBudget > 0, spendSource: accountBudget > 0 ? 'account' : 'none',
      statusLabels: [] },
    delta: { spendLast15min: 0, spendLastHour: 0, speedCurrent: 0, speedHour: 0,
      prevCPA15: 0, prevCPA30: 0, prevTotal15: 0, budgetUsed: 0, dailyBudget: effectiveBudget,
      timeProgress: 0, idealSpend: 0, pacingRatio: 0, pacingHealth: 'N/A', projectedDaily: 0,
      timeSlot: '已结束', elapsedHours: 0, windowDuration: 16, currentHour: 0,
      convLast15min: 0, cplLast15min: 0,
      trends: null, yoy: null, lifecycle: {} },
    topNewSpenders: [], rampingUp: [], dropping: [], topSpenders: [], topPerformers: [], topCVR: [],
    time: new Date().toISOString(),
  };
  let totalConversions = allSpending.reduce((s, c) => s + c.conversions, 0);
  let avgCPA = totalConversions > 0 ? totalSpend / totalConversions : 0;
  const avgCTR = active.length > 0 ? active.reduce((s, c) => s + c.ctr, 0) / active.length : 0;
  const avgCVR = active.length > 0 ? active.reduce((s, c) => s + c.cvr, 0) / active.length : 0;
  let avgCPM = active.length > 0 ? active.reduce((s, c) => s + c.cpm, 0) / active.length : 0;
  
  // ====== 转化漏斗 (所有有消耗计划) ======
  let totalLeads = allSpending.reduce((s, c) => s + (c.leads || 0), 0);
  let totalPrivateMsgOpen = allSpending.reduce((s, c) => s + (c.privateMsgOpen || 0), 0);
  let totalPrivateMsgRetain = allSpending.reduce((s, c) => s + (c.privateMsgRetain || 0), 0);
  let totalFormSubmit = allSpending.reduce((s, c) => s + (c.formSubmit || 0), 0);
  let openRetainRate = totalPrivateMsgOpen > 0 ? totalPrivateMsgRetain / totalPrivateMsgOpen : 0;

  // ====== 直播间数据汇总 ======
  let totalLiveViews = allSpending.reduce((s, c) => s + (c.liveViews || 0), 0);
  let totalLiveOver1Min = allSpending.reduce((s, c) => s + (c.liveOver1Min || 0), 0);
  let viewRetention = totalLiveViews > 0 ? totalLiveOver1Min / totalLiveViews : 0;
  // 转化效率：每千元消耗的转化数
  const convEfficiency = totalSpend > 0 ? totalConversions / (totalSpend / 1000) : 0;

  // ====== 页面汇总行校准 ======
  // 必须在所有分析前校准 totalSpend/avgCPA，确保 pacing/alerts 使用校准值 (#5, #6)
  if (pageSummary) {
    if (pageSummary.spend > 0) {
      totalSpend = pageSummary.spend;
      console.log(`  ✅ 页面汇总校准 totalSpend: ¥${totalSpend.toFixed(0)}`);
    }
    if (pageSummary.conversions > 0) {
      totalConversions = pageSummary.conversions;
      totalLeads = pageSummary.leads;
      totalPrivateMsgOpen = pageSummary.privateMsgOpen;
      totalPrivateMsgRetain = pageSummary.privateMsgRetain;
      totalFormSubmit = pageSummary.formSubmit;
      openRetainRate = totalPrivateMsgOpen > 0 ? totalPrivateMsgRetain / totalPrivateMsgOpen : 0;
      console.log(`  ✅ 页面汇总校准: 转化${totalConversions} 线索${totalLeads} 开口${totalPrivateMsgOpen} 留资${totalPrivateMsgRetain} 表单${totalFormSubmit}`);
    }
    // 汇总行 CPM / 停留率 (使用页面总计行的加权均值, 而非逐计划算数平均)
    if (pageSummary.cpm > 0) {
      avgCPM = pageSummary.cpm;
    }
    if (pageSummary.liveViews > 0) {
      totalLiveViews = pageSummary.liveViews;
      totalLiveOver1Min = pageSummary.liveOver1Min;
      viewRetention = totalLiveViews > 0 ? totalLiveOver1Min / totalLiveViews : 0;
    }
  }
  avgCPA = totalConversions > 0 ? totalSpend / totalConversions : 0;
  
  // ====== 加载历史数据 ======
  const prev = loadPreviousSnapshots();
  // 历史总消耗：优先用 accountSpend，没有则降级用 totalSpend（null=不可计算）
  // 兼容旧快照（v2 及之前）可能用 allSpending 字段
  // 优先用 allSpending（含更多计划），避免"新出现"的计划被误算全部消耗
  const prevCampaigns15 = (prev.t15?.allSpending?.length > (prev.t15?.active?.length || 0))
    ? prev.t15.allSpending
    : (prev.t15?.active?.length ? prev.t15.active : (prev.t15?.allSpending || []));
  const prevCampaigns30 = (prev.t30?.allSpending?.length > (prev.t30?.active?.length || 0))
    ? prev.t30.allSpending
    : (prev.t30?.active?.length ? prev.t30.active : (prev.t30?.allSpending || []));
  const prevIndex15 = prev.t15 ? buildCampaignIndex(prevCampaigns15) : new Map();
  const prevIndex30 = prev.t30 ? buildCampaignIndex(prevCampaigns30) : new Map();

  // 历史总消耗/CPA 对比基线
  const prevTotal15 = prev.t15?.summary?.accountSpend > 0 ? prev.t15.summary.accountSpend : (prev.t15?.summary?.totalSpend || null);
  const prevTotal30 = prev.t30?.summary?.accountSpend > 0 ? prev.t30.summary.accountSpend : (prev.t30?.summary?.totalSpend || prevTotal15);
  const prevTotal60 = prev.t60?.summary?.accountSpend > 0 ? prev.t60.summary.accountSpend : (prev.t60?.summary?.totalSpend || prevTotal30);
  const prevCPA15 = prev.t15?.summary?.avgCPA || avgCPA;
  const prevCPA30 = prev.t30?.summary?.avgCPA || prevCPA15;

  // 消耗速度 (元/分钟)
  const spendLast15min = prevTotal15 !== null ? totalSpend - prevTotal15 : 0;
  const speedCurrent = spendLast15min / 15;
  const spendLastHour = prevTotal15 !== null && prevTotal60 !== null ? (totalSpend - prevTotal60) : spendLast15min;
  const speedHour = prevTotal60 !== null ? (totalSpend - prevTotal60) / 60 : speedCurrent;

  // ====== 每计划增量分析 ======
  const campaignDeltas = [];
  for (const c of active) {
    const prevC = prevIndex15.get(c.id);
    const spendDelta = prevC ? c.spend - prevC.spend : c.spend; // 新出现的计划，增量=全部消耗
    const spendPrev = prevC?.spend || 0.01;
    const changeRate = spendPrev > 0.01 ? (spendDelta / spendPrev) : (c.spend > 0 ? 1 : 0);
    const convDelta = prevC ? c.conversions - prevC.conversions : c.conversions;
    const cpa15 = convDelta > 0 ? spendDelta / convDelta : 0;
    
    let trend;
    if (spendDelta < 0.5 && c.spend < 5) trend = '休眠';
    else if (changeRate > 0.3 && spendDelta > 5) trend = '起量';
    else if (changeRate < -0.3 && prevC && prevC.spend > 10) trend = '掉量';
    else if (spendDelta >= 5) trend = '稳定消耗';
    else trend = '微量';
    
    campaignDeltas.push({
      ...c,
      spendDelta, changeRate, convDelta, cpa15,
      trend,
      spendPrev: prevC?.spend || 0,
    });
  }
  
  // ====== 近15分钟CPL ======
  // 校验快照时效性：超过35分钟视为过旧，不计算近15分钟增量
  let convLast15min = 0;
  let cplLast15min = 0;
  const prevAge = prev.t15?._ageMinutes || Infinity;
  if (prev.t15 && prevAge <= 35) {
    convLast15min = campaignDeltas.reduce((s, c) => s + (c.convDelta || 0), 0);
    cplLast15min = convLast15min > 0 ? spendLast15min / convLast15min : 0;
  } else {
    convLast15min = -1; // -1 表示数据不足
    const ageStr = prev.t15 ? `${prevAge.toFixed(0)}分钟前` : '无历史快照';
    console.log(`  ⚠ 近15分钟快照过旧(${ageStr})，跳过增量计算`);
  }

  // 按近15分钟新增消耗排序
  const byNewSpend = [...campaignDeltas].sort((a, b) => b.spendDelta - a.spendDelta);
  const topNewSpenders = byNewSpend.slice(0, 8); // TOP8 新消耗主力
  const rampingUp = campaignDeltas.filter(c => c.trend === '起量').sort((a, b) => b.changeRate - a.changeRate);
  const dropping = campaignDeltas.filter(c => c.trend === '掉量').sort((a, b) => a.changeRate - b.changeRate);
  
  console.log('  [DEBUG] CK5: pacing calc start, totalSpend=' + totalSpend + ' effectiveBudget=' + effectiveBudget);

  // ====== 消耗节奏分析 ======
  const { dailyStartHour, dailyEndHour } = CONFIG;
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const windowDuration = dailyEndHour - dailyStartHour; // 16h (7-23)
  const elapsedHours = Math.max(0, Math.min(currentHour - dailyStartHour, windowDuration));
  const timeProgress = Math.min(elapsedHours / windowDuration, 1); // 0-1
  const idealSpend = timeProgress * effectiveBudget;
  const pacingRatio = idealSpend > 0 ? totalSpend / idealSpend : 0;
  
  // 预估今日总消耗（按当前均速推算）
  const minutesElapsed = Math.max(elapsedHours * 60, 1);
  const avgSpeed = totalSpend / minutesElapsed; // 今日平均元/分钟
  const remainingMinutes = Math.max((dailyEndHour - Math.min(currentHour, dailyEndHour)) * 60, 0);
  const projectedDaily = totalSpend + avgSpeed * remainingMinutes;
  
  let pacingHealth;
  if (pacingRatio >= 0.8 && pacingRatio <= 1.2) pacingHealth = 'good';
  else if (pacingRatio >= 0.6 && pacingRatio <= 1.5) pacingHealth = 'warning';
  else pacingHealth = 'danger';
  
  // 当前时段标签 (16h: 7-23)
  let timeSlot;
  if (currentHour < dailyStartHour) timeSlot = '未开始';
  else if (currentHour < 9) timeSlot = '冷启动期';
  else if (currentHour < 11) timeSlot = '早高峰';
  else if (currentHour < 14) timeSlot = '午高峰';
  else if (currentHour < 17) timeSlot = '午后平稳期';
  else if (currentHour < 20) timeSlot = '晚高峰';
  else if (currentHour < dailyEndHour) timeSlot = '夜间收尾';
  else timeSlot = '已结束';
  
  console.log('  [DEBUG] CK6: alerts-start, pacingHealth=' + pacingHealth + ' timeSlot=' + timeSlot);

  // ====== 多日基线 + 3h窗口分析 ======
  const multiDay = loadMultiDayBaseline(3);
  const window3h = analyze3HourWindow();

  // ====== 告警逻辑 ======
  const alerts = [];
  
  // ====== A. 3h 窗口波动告警 (替换旧的15min/30min) ======
  if (window3h) {
    // A1. 3h 消耗速度剧烈波动（后半3h vs 前半3h）
    if (window3h.speed.change > 0.5 && window3h.spend.second > 200) {
      const excess = (window3h.speed.change * 100).toFixed(0);
      alerts.push({
        type: 'speed_3h',
        name: '3h消耗速度飙升',
        detail: `近1.5h均速 ¥${window3h.speed.second.toFixed(0)}/min，较前1.5h ¥${window3h.speed.first.toFixed(0)}/min 涨 ${excess}%`,
        severity: window3h.speed.change > 1.0 ? 'high' : 'medium',
      });
    } else if (window3h.speed.change < -0.5 && window3h.spend.first > 200) {
      const drop = (Math.abs(window3h.speed.change) * 100).toFixed(0);
      alerts.push({
        type: 'speed_3h',
        name: '3h消耗速度骤降',
        detail: `近1.5h均速 ¥${window3h.speed.second.toFixed(0)}/min，较前1.5h ¥${window3h.speed.first.toFixed(0)}/min 跌 ${drop}%`,
        severity: 'medium',
      });
    }

    // A2. 3h CPL 异常波动
    if (window3h.cpa.first > 0 && window3h.cpa.second > 0 && window3h.cpa.change > 0.25) {
      const rise = (window3h.cpa.change * 100).toFixed(0);
      alerts.push({
        type: 'cpa_3h',
        name: '3h成本持续攀升',
        detail: `近1.5h CPL ¥${window3h.cpa.second.toFixed(0)}，较前1.5h ¥${window3h.cpa.first.toFixed(0)} 涨 ${rise}%`,
        severity: window3h.cpa.change > 0.5 ? 'high' : 'medium',
      });
    }

    // A3. 3h 转化率坍塌
    if (window3h.convRate.change < -0.3 && window3h.convRate.second > 0) {
      const drop = (Math.abs(window3h.convRate.change) * 100).toFixed(0);
      alerts.push({
        type: 'conv_drop_3h',
        name: '3h转化效率下降',
        detail: `近1.5h 每千元转化 ${window3h.convRate.second.toFixed(1)}，较前1.5h ${window3h.convRate.first.toFixed(1)} 跌 ${drop}%`,
        severity: window3h.convRate.change < -0.5 ? 'high' : 'medium',
      });
    }

    // A4. 3h 燃烧加速率异常
    if (window3h.burnRate.change > 0.6 && window3h.burnRate.second > 500) {
      const accel = (window3h.burnRate.change * 100).toFixed(0);
      alerts.push({
        type: 'burn_accel_3h',
        name: '消耗加速度异常',
        detail: `近段燃烧速率 ¥${window3h.burnRate.second.toFixed(0)}/h，较前段 ¥${window3h.burnRate.first.toFixed(0)}/h 加速 ${accel}%`,
        severity: window3h.burnRate.change > 1.2 ? 'high' : 'medium',
      });
    }
  }

  // ====== B. 多日基线异常 (vs 近3天同时段) ======
  if (multiDay) {
    // B1. 消耗远低于3日均值（可能掉量）
    if (multiDay.spend.mean > 0 && totalSpend < multiDay.spend.mean * 0.6 && timeProgress > 0.15) {
      const pct = ((totalSpend / multiDay.spend.mean) * 100).toFixed(0);
      alerts.push({
        type: 'spend_vs_3d',
        name: '消耗远低于3日均值',
        detail: `当前 ¥${totalSpend.toFixed(0)}，仅为近3天同时段均值 ¥${multiDay.spend.mean.toFixed(0)} 的 ${pct}%，可能计划掉量或出价过低`,
        severity: totalSpend < multiDay.spend.mean * 0.4 ? 'high' : 'medium',
      });
    }

    // B2. CPA 显著高于3日均值（>2σ或>40%）
    if (multiDay.cpa && avgCPA > 0) {
      const cpaSigma = multiDay.cpa.stdev > 0 ? (avgCPA - multiDay.cpa.mean) / multiDay.cpa.stdev : 0;
      const cpaRatio = multiDay.cpa.mean > 0 ? avgCPA / multiDay.cpa.mean : 0;
      if ((cpaSigma > 2.5 || cpaRatio > 1.4) && cpaRatio > 1.2) {
        alerts.push({
          type: 'cpa_vs_3d',
          name: `CPA 显著偏高 (${cpaSigma.toFixed(1)}σ)`,
          detail: `当前 CPL ¥${avgCPA.toFixed(0)}，近3天同时段均值 ¥${multiDay.cpa.mean.toFixed(0)}（${(cpaRatio*100).toFixed(0)}%），异常偏高`,
          severity: cpaSigma > 3.5 ? 'high' : 'medium',
        });
      }
    }

    // B3. 转化数严重低于3日均值
    if (multiDay.conversions.mean > 0 && totalConversions < multiDay.conversions.mean * 0.5 && timeProgress > 0.15) {
      alerts.push({
        type: 'conv_vs_3d',
        name: '转化量远低于3日均值',
        detail: `当前 ${totalConversions}条转化，仅为近3天同时段均值 ${multiDay.conversions.mean.toFixed(0)} 的 ${((totalConversions/multiDay.conversions.mean)*100).toFixed(0)}%`,
        severity: 'medium',
      });
    }

    // B4. 投放计划数异常减少
    if (multiDay.activeCount && active.length < multiDay.activeCount.mean * 0.6 && timeProgress > 0.1) {
      alerts.push({
        type: 'plan_count_drop',
        name: '投放计划数异常减少',
        detail: `当前 ${active.length} 条投放中，近3天同时段均值 ${multiDay.activeCount.mean.toFixed(0)} 条，检查是否有计划异常暂停`,
        severity: active.length < multiDay.activeCount.mean * 0.4 ? 'high' : 'medium',
      });
    }

    // B5. 开口留资率异常 (vs 3天同时段均值)
    if (multiDay.openRetainRate && openRetainRate > 0 && multiDay.openRetainRate.stdev > 0.02) {
      const rrSigma = (openRetainRate - multiDay.openRetainRate.mean) / multiDay.openRetainRate.stdev;
      if (rrSigma < -2.0) {
        alerts.push({
          type: 'retain_rate_drop',
          name: `开口留资率异常偏低 (${rrSigma.toFixed(1)}σ)`,
          detail: `当前开留率 ${(openRetainRate*100).toFixed(1)}%，近3天均值 ${(multiDay.openRetainRate.mean*100).toFixed(1)}%，显著低于历史水平`,
          severity: rrSigma < -3 ? 'high' : 'medium',
        });
      }
    }

    // B6. CPM 异常 (vs 3天同时段均值)
    if (multiDay.cpm && avgCPM > 0 && multiDay.cpm.stdev > 1) {
      const cpmSigma = (avgCPM - multiDay.cpm.mean) / multiDay.cpm.stdev;
      const cpmRatio = multiDay.cpm.mean > 0 ? avgCPM / multiDay.cpm.mean : 0;
      if (cpmSigma > 2.5 || cpmRatio > 1.4) {
        alerts.push({
          type: 'cpm_spike',
          name: `CPM 显著偏高 (${cpmSigma.toFixed(1)}σ)`,
          detail: `当前 CPM ¥${avgCPM.toFixed(1)}，近3天均值 ¥${multiDay.cpm.mean.toFixed(1)} (${(cpmRatio*100).toFixed(0)}%)，竞争加剧或人群质量变差`,
          severity: cpmSigma > 3.5 ? 'high' : 'medium',
        });
      }
    }

    // B7. 观看停留率异常 (≥1min观看/总观看)
    if (multiDay.viewRetention && viewRetention > 0 && multiDay.viewRetention.stdev > 0.02) {
      const vrSigma = (viewRetention - multiDay.viewRetention.mean) / multiDay.viewRetention.stdev;
      if (vrSigma < -2.0) {
        alerts.push({
          type: 'view_retention_drop',
          name: `观看停留率异常偏低 (${vrSigma.toFixed(1)}σ)`,
          detail: `当前停留率 ${(viewRetention*100).toFixed(1)}%（${totalLiveOver1Min}/${totalLiveViews}），近3天均值 ${(multiDay.viewRetention.mean*100).toFixed(1)}%，直播间内容吸引力下降`,
          severity: vrSigma < -3 ? 'high' : 'medium',
        });
      }
    }

    // B8. 转化效率下降 (每千元消耗转化数 vs 3天)
    if (multiDay.convEfficiency && convEfficiency > 0 && multiDay.convEfficiency.mean > 0 && convEfficiency < multiDay.convEfficiency.mean * 0.6) {
      alerts.push({
        type: 'conv_efficiency_drop',
        name: '转化效率显著下降',
        detail: `当前 ¥1k→${convEfficiency.toFixed(1)}条转化，近3天均值 ${multiDay.convEfficiency.mean.toFixed(1)}条，转化效率仅为历史 ${(convEfficiency/multiDay.convEfficiency.mean*100).toFixed(0)}%`,
        severity: convEfficiency < multiDay.convEfficiency.mean * 0.4 ? 'high' : 'medium',
      });
    }
  }

  // ====== 复合风险检测 ======
  // 多个维度同时恶化 → 系统性问题
  const compoundRisks = [];
  const multiDayRef = multiDay;
  if (multiDayRef) {
    const rrBad = multiDayRef.openRetainRate && openRetainRate > 0 && multiDayRef.openRetainRate.stdev > 0.02 && (openRetainRate - multiDayRef.openRetainRate.mean) / multiDayRef.openRetainRate.stdev < -1.5;
    const cpaBad = multiDayRef.cpa && avgCPA > 0 && multiDayRef.cpa.mean > 0 && avgCPA > multiDayRef.cpa.mean * 1.25;
    const cpmBad = multiDayRef.cpm && avgCPM > 0 && multiDayRef.cpm.mean > 0 && avgCPM > multiDayRef.cpm.mean * 1.3;
    const vrBad = multiDayRef.viewRetention && viewRetention > 0 && multiDayRef.viewRetention.stdev > 0.02 && (viewRetention - multiDayRef.viewRetention.mean) / multiDayRef.viewRetention.stdev < -1.5;
    const effBad = multiDayRef.convEfficiency && convEfficiency > 0 && multiDayRef.convEfficiency.mean > 0 && convEfficiency < multiDayRef.convEfficiency.mean * 0.6;

    if (cpaBad || cpmBad) compoundRisks.push(cpaBad ? 'CPL↑' : 'CPM↑');
    if (rrBad) compoundRisks.push('留资率↓');
    if (vrBad) compoundRisks.push('停留率↓');
    if (effBad) compoundRisks.push('效率↓');

    if (compoundRisks.length >= 2) {
      alerts.push({
        type: 'compound_risk',
        name: `复合风险: ${compoundRisks.join('+')} 同时恶化`,
        detail: `检测到 ${compoundRisks.length} 个维度同时恶化（${compoundRisks.join(', ')}），可能为系统性问题，建议排查投放策略或直播间质量`,
        severity: compoundRisks.length >= 3 ? 'high' : 'medium',
      });
    }
  }

  // ====== C. 单个维度的简单告警 (保留核心) ======
  // C1. 15分钟突发速度 (快照恢复后可用)
  if (speedHour > 0 && speedCurrent > speedHour * 2 && spendLast15min > 100) {
    alerts.push({
      type: 'speed_spike',
      name: '15m突发消耗加速',
      detail: `近15m速度 ¥${speedCurrent.toFixed(0)}/min，为1h均速的 ${((speedCurrent/speedHour)*100).toFixed(0)}%`,
      severity: speedCurrent > speedHour * 3 ? 'high' : 'medium',
    });
  }

  // ====== D. 日预算 + 节奏异常 ======
  const budgetUsed = totalSpend / effectiveBudget;
  if (budgetUsed > 0.85) {
    alerts.push({
      type: 'budget',
      name: budgetUsed > 1 ? '日预算已用完' : '日预算即将耗尽',
      detail: `已消耗 ¥${totalSpend.toFixed(0)} / 预算 ¥${effectiveBudget.toFixed(0)} (${(budgetUsed*100).toFixed(0)}%)，预估今日 ¥${projectedDaily.toFixed(0)}`,
      severity: budgetUsed > 1 ? 'high' : budgetUsed > 0.92 ? 'high' : 'medium',
    });
  }
  if (pacingHealth === 'danger' && pacingRatio > 1.5 && budgetUsed < 0.85) {
    alerts.push({
      type: 'pacing_fast',
      name: '消耗节奏过快',
      detail: `已消耗 ¥${totalSpend.toFixed(0)} (${(budgetUsed*100).toFixed(0)}%)，远超时间进度 ${(timeProgress*100).toFixed(0)}%`,
      severity: pacingRatio > 2 ? 'high' : 'medium',
    });
  }
  if (pacingHealth === 'danger' && pacingRatio < 0.6 && timeProgress > 0.3) {
    alerts.push({
      type: 'pacing_slow',
      name: '消耗进度严重落后',
      detail: `已消耗 ¥${totalSpend.toFixed(0)} (${(budgetUsed*100).toFixed(0)}%)，落后时间进度 ${(timeProgress*100).toFixed(0)}%`,
      severity: 'medium',
    });
  }
  
  // 4. 计划级告警：零转化、高成本、撞线
  for (const c of campaignDeltas) {
    if (c.spend > 50 && c.conversions === 0) {
      alerts.push({
        type: 'zero_conv',
        name: `零转化消耗: ${c.name.slice(0, 25)}`,
        detail: `消耗 ¥${c.spend.toFixed(0)} 但零转化，是否需要暂停？`,
        severity: c.spend > 200 ? 'high' : 'medium',
        campaignId: c.id,
        needAction: true,  // 标记：需要询问用户是否执行操作
      });
    }
    if (c.cpa > avgCPA * 2.5 && c.spend > 30 && c.conversions > 0) {
      alerts.push({
        type: 'high_cpa',
        name: `高成本计划: ${c.name.slice(0, 25)}`,
        detail: `CPL ¥${c.cpa.toFixed(2)} (均值 ¥${avgCPA.toFixed(2)}的 ${(c.cpa/avgCPA).toFixed(1)}x)，消耗 ¥${c.spend.toFixed(0)}，建议关停`,
        severity: c.spend > 100 ? 'high' : 'medium',
        campaignId: c.id,
      });
    }
    // 计划预算撞线预警：分两个阶梯
    const planBudget = parsePlanBudget(c.budget);
    if (planBudget > 0 && c.spend >= planBudget * 0.8) {
      const exceedPct = ((c.spend / planBudget) * 100);
      if (c.spend >= planBudget) {
        // 阶梯2: 已达到100%，已撞线暂停
        alerts.push({
          type: 'budget_cap',
          name: `已撞线暂停: ${c.name.slice(0, 22)}`,
          detail: `消耗 ¥${c.spend.toFixed(0)} 已达计划预算 ¥${planBudget.toFixed(0)} (${exceedPct.toFixed(0)}%)，已暂停投放，建议追加预算并手动恢复`,
          severity: 'high',
          campaignId: c.id,
        });
      } else {
        // 阶梯1: 超过80%，预算即将耗尽
        alerts.push({
          type: 'budget_cap',
          name: `预算即将耗尽: ${c.name.slice(0, 22)}`,
          detail: `消耗 ¥${c.spend.toFixed(0)} / 计划预算 ¥${planBudget.toFixed(0)} (${exceedPct.toFixed(0)}%)，接近上限建议追加`,
          severity: 'medium',
          campaignId: c.id,
        });
      }
    }
  }

  // 4.5 账户级预算监控 (独立预警：账户日预算使用率)
  if (accountBudget > 0) {
    const accountBudgetUsed = accountSpend / accountBudget;
    if (accountSpend >= accountBudget * 0.8) {
      const exceedPct = ((accountSpend / accountBudget) * 100);
      if (accountSpend >= accountBudget) {
        // 阶梯2: 账户日预算已用完
        alerts.push({
          type: 'account_budget_cap',
          name: '账户日预算已用完',
          detail: `账户消耗 ¥${accountSpend.toFixed(0)} 已达日预算 ¥${accountBudget.toFixed(0)} (${exceedPct.toFixed(0)}%)，所有计划将暂停，建议追加账户预算`,
          severity: 'high',
        });
      } else {
        // 阶梯1: 账户日预算使用超过80%
        alerts.push({
          type: 'account_budget_cap',
          name: '账户预算即将耗尽',
          detail: `账户消耗 ¥${accountSpend.toFixed(0)} / 日预算 ¥${accountBudget.toFixed(0)} (${exceedPct.toFixed(0)}%)，建议追加账户预算或调整计划预算分配`,
          severity: 'medium',
        });
      }
    }
  }

  console.log('  [DEBUG] CK10: funnel-updated, alertCount=' + alerts.length + ' totalLeads=' + totalLeads);

  // 5. 掉量计划汇总告警
  if (dropping.length >= 3) {
    alerts.push({
      type: 'dropping',
      name: `${dropping.length} 条计划在掉量`,
      detail: dropping.map(c => `${c.name.slice(0, 15)}: 近15分钟消耗 ¥${c.spendDelta.toFixed(1)} (变化 ${(c.changeRate*100).toFixed(0)}%)`).join('\n'),
      severity: dropping.length >= 5 ? 'medium' : 'low',
    });
  }
  
  // ====== 滑动窗口趋势检测 ======
  const trends = detectTrends();
  if (trends.cpaTrend && trends.cpaTrend.changeRate > 0.08) {
    alerts.push({
      type: 'cpa_trend',
      name: 'CPL 持续走高趋势',
      detail: `近${trends.cpaTrend.periods}个周期CPL以每15分钟 ¥${trends.cpaTrend.slope.toFixed(2)} 的速度上升，预估继续走高 ${(trends.cpaTrend.changeRate*100).toFixed(0)}%`,
      severity: trends.cpaTrend.changeRate > 0.15 ? 'high' : 'medium',
    });
  }
  if (trends.spendTrend && trends.spendTrend.changeRate > 0.15) {
    alerts.push({
      type: 'spend_trend',
      name: '消耗持续加速趋势',
      detail: `近${trends.spendTrend.periods}个周期消耗速度以每15分钟 ¥${trends.spendTrend.slope.toFixed(2)} 递增，需关注预算`,
      severity: trends.spendTrend.changeRate > 0.3 ? 'high' : 'medium',
    });
  }

  // ====== 同比基线 ======
  const yoy = loadYesterdayBaseline();
  const yoyInfo = yoy ? {
    yesterdaySpend: yoy.totalSpend,
    yesterdayCPA: yoy.avgCPA,
    yesterdayConversions: yoy.totalConversions,
    spendVsYesterday: yoy.totalSpend > 0 ? ((totalSpend - yoy.totalSpend) / yoy.totalSpend) : null,
    cpaVsYesterday: yoy.avgCPA > 0 ? ((avgCPA - yoy.avgCPA) / yoy.avgCPA) : null,
    yesterdayDate: yoy.date,
  } : null;

  // ====== 计划生命周期追踪 ======
  updateCampaignLifecycle(active);
  const lifecycleSummary = { cold_start: 0, active: 0, declining: 0, dead: 0 };
  for (const c of active) {
    const stage = getCampaignLifecycleStage(c.id);
    c._lifecycle = stage;
    if (lifecycleSummary[stage] !== undefined) lifecycleSummary[stage]++;
  }
  
  // 疑似死亡的冷启动计划告警
  const deadCampaigns = active.filter(c => c._lifecycle === 'dead');
  if (deadCampaigns.length > 0) {
    alerts.push({
      type: 'dead_plan',
      name: `${deadCampaigns.length} 条计划疑似死亡`,
      detail: deadCampaigns.map(c => `${c.name.slice(0, 15)}: 连续低消耗，可能已无效`).join('; '),
      severity: 'low',
    });
  }

  // 按严重程度排序
  const severityOrder = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // ====== 返回最终分析结果 ======
  console.log('  [DEBUG] CK16: pre-return, totalSpend=' + totalSpend + ' totalConversions=' + totalConversions + ' avgCPA=' + avgCPA.toFixed(2));
  return {
    active, allSpending, paused: campaigns.filter(c => c.status.includes('暂停')).length,
    summary: {
      totalActive: active.length, totalSpending: allSpending.length,
      totalSpend, totalConversions, avgCPA, avgCTR, avgCVR, avgCPM,
      // 转化漏斗
      totalLeads, totalPrivateMsgOpen, totalPrivateMsgRetain, totalFormSubmit, openRetainRate,
      // 直播间 + 效率
      totalLiveViews, totalLiveOver1Min, viewRetention, convEfficiency,
      // 账户级数据
      accountSpend: hasAccountData ? accountSpend : null,
      accountBudget: accountBudget > 0 ? accountBudget : null,
      accountBalance: accountBalance > 0 ? accountBalance : null,
      useAccountSpend,
      spendSource,
      // 状态分布
      statusLabels,
    },
    // 新增：增量分析
    delta: {
      spendLast15min,
      spendLastHour,
      speedCurrent,
      speedHour,
      prevCPA15,
      prevCPA30,
      prevTotal15,
      budgetUsed,
      dailyBudget: effectiveBudget,
      // 近15分钟CPL
      convLast15min,
      cplLast15min,
      // 新增：节奏分析
      timeProgress,
      idealSpend,
      pacingRatio,
      pacingHealth,
      projectedDaily,
      timeSlot,
      elapsedHours,
      windowDuration,
      currentHour,
      // 趋势与同比
      trends: trends.cpaTrend || trends.spendTrend ? trends : null,
      yoy: yoyInfo,
      lifecycle: lifecycleSummary,
    },
    // 近15分钟新增消耗排名
    topNewSpenders,
    rampingUp: rampingUp.slice(0, 5),
    // 3h窗口分析 + 多日基线（供卡片展示）
    _multiDay: multiDay,
    _window3h: window3h,
    dropping: dropping.slice(0, 5),
    // 兼容旧字段
    topSpenders: topNewSpenders.map(c => ({...c})), 
    topPerformers: campaignDeltas.filter(c => c.conversions > 0).sort((a, b) => a.cpa - b.cpa).slice(0, 5),
    topCVR: campaignDeltas.filter(c => c.conversions > 0).sort((a, b) => b.cvr - a.cvr).slice(0, 5),
    alerts,
    time: new Date().toISOString(),
  };
}

// ====== HTML ======
function generateHTML(analysis) {
  const { summary, active, allSpending, topNewSpenders, topPerformers, topCVR, alerts, delta, rampingUp, dropping } = analysis;
  const now = new Date().toLocaleString('zh-CN');
  const today = getLocalDate();
  const d = delta || {};
  
  // ====== 加载建议历史 ======
  const history = loadSuggestionHistory();
  markIgnoredSuggestions();
  
  const alertsHTML = alerts.length > 0 ? alerts.map(a => {
    const color = a.severity === 'high' ? '#e74c3c' : a.severity === 'medium' ? '#f39c12' : '#3498db';
    const label = a.severity === 'high' ? '⚠严重' : a.severity === 'medium' ? '⚡注意' : 'ℹ提示';
    const typeLabel = { speed: '消耗速度', cpa_rise: '成本上涨', budget: '预算', budget_cap: '计划撞线', account_budget_cap: '账户预算', zero_conv: '零转化', high_cpa: '高成本', dropping: '掉量', pacing_fast: '节奏过快', pacing_slow: '节奏落后' }[a.type] || a.type;
    const suppressed = (a.type === 'zero_conv' || a.type === 'high_cpa' || a.type === 'budget_cap')
      && !shouldSuggest(a.type, a.campaignId, history).suggest;
    return `<tr style="border-left:3px solid ${color}; ${suppressed ? 'opacity:0.5' : ''}">
      <td><span class="badge bg-${a.severity==='high'?'red':a.severity==='medium'?'yellow':'green'}">${typeLabel}</span> ${a.name}${suppressed ? ' <span style="font-size:10px;color:#999">(历史已抑制)</span>' : ''}</td>
      <td colspan="4">${a.detail.replace(/\n/g, '<br>')}</td>
      <td><span style="color:${color};font-weight:bold">${label}</span></td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" style="text-align:center;color:#27ae60;padding:16px">✅ 消耗平稳，成本可控，无异常</td></tr>';

  // ====== 全量计划表 (所有有消耗的计划，按消耗降序) ======
  const planList = (allSpending && allSpending.length > 0) ? allSpending : (active || []);
  const allPlanRows = planList.sort((a, b) => b.spend - a.spend).map(c => {
    const planBudget = parsePlanBudget(c.budget);
    const capPct = planBudget > 0 ? (c.spend / planBudget * 100) : 0;
    const capStyle = capPct >= 100 ? 'color:#e74c3c;font-weight:bold' : capPct >= 80 ? 'color:#e67e22;font-weight:bold' : '';
    const cpaColor = c.cpa > (summary.avgCPA || 100) * 1.5 ? '#e74c3c' : c.cpa > (summary.avgCPA || 100) * 1.2 ? '#e67e22' : '#27ae60';
    const lcStage = c._lifecycle || 'unknown';
    const lcEmoji = { cold_start: '🌱', active: '🔥', declining: '📉', dead: '💀' }[lcStage] || '';
    // 标准化状态显示
    let statusDisplay = c.status || '';
    if (statusDisplay.includes('启用中') || statusDisplay.includes('投放中')) statusDisplay = '投放中';
    else if (statusDisplay.includes('超出预算')) statusDisplay = '未投放(超出预算)';
    else if (statusDisplay.includes('暂停')) statusDisplay = '未投放(已暂停)';
    const statusColor = statusDisplay === '投放中' ? '#10b981' : '#94a3b8';
    return `
    <tr>
      <td style="max-width:160px" title="${c.name}">${c.name.slice(0, 28)}<br><span style="color:#888;font-size:10px">ID:${(c.id||'').slice(-10)}</span></td>
      <td><span style="color:${statusColor};font-size:11px">${statusDisplay}</span></td>
      <td style="font-weight:bold">¥${c.spend.toFixed(0)}</td>
      <td style="font-weight:bold;color:${cpaColor}">¥${(c.cpa||0).toFixed(0)}</td>
      <td>${c.conversions||0}</td>
      <td style="color:${(c.leads||0) !== (c.conversions||0) ? '#e67e22' : '#64748b'}">${c.leads||0}</td>
      <td>${c.privateMsgRetain||0}</td>
      <td>${c.formSubmit||0}</td>
      <td>${c.privateMsgOpen||0}</td>
      <td>${(c.ctr*100).toFixed(2)}%</td>
      <td>${(c.cvr*100).toFixed(2)}%</td>
      <td style="${capStyle}">${planBudget > 0 ? '¥'+planBudget.toFixed(0)+' ('+capPct.toFixed(0)+'%)' : 'N/A'}</td>
      <td><span title="${lcStage}">${lcEmoji}</span></td>
    </tr>`;
  }).join('');

  // ====== 建议历史摘要 ======
  const histRows = (history.suggestions || []).slice(-20).reverse().map(s => {
    const respIcon = s.response === 'accept' ? '✅' : s.response === 'reject' ? '❌' : '⏳';
    const typeLabel = { zero_conv: '暂停零转化', high_cpa: '关停高成本', budget_cap: '追加预算' }[s.alertType] || s.alertType;
    return `<tr>
      <td>${new Date(s.time).toLocaleString('zh-CN')}</td>
      <td>${typeLabel}</td>
      <td>${s.campaignName || '—'}</td>
      <td>${s.suggestion || '—'}</td>
      <td>${respIcon} ${s.response === 'accept' ? '采纳' : s.response === 'reject' ? '拒绝' : '待定'}</td>
    </tr>`;
  }).join('');

  // ====== 转化漏斗可视化 ======
  const maxFunnel = Math.max(summary.totalPrivateMsgOpen || 1, summary.totalPrivateMsgRetain || 1, summary.totalFormSubmit || 1, summary.totalLeads || 1, summary.totalConversions || 1);
  const funnelBar = (val, label, color) => {
    const pct = maxFunnel > 0 ? (val / maxFunnel * 100) : 0;
    return `<div style="margin:4px 0;display:flex;align-items:center;gap:8px">
      <span style="width:80px;font-size:12px;text-align:right">${label}</span>
      <div style="flex:1;background:#f1f5f9;border-radius:6px;height:20px;overflow:hidden">
        <div style="width:${pct}%;background:${color};height:100%;border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding-right:8px">
          <span style="font-size:11px;color:#fff;font-weight:600">${val}</span>
        </div>
      </div>
      <span style="font-size:11px;color:#94a3b8;width:50px">${pct.toFixed(0)}%</span>
    </div>`;
  };

  const campaignRows = (topNewSpenders || []).map(c => {
    const trendTag = c.trend === '起量' ? '<span class="badge bg-green">起量</span>' :
      c.trend === '稳定消耗' ? '<span class="badge bg-green">稳定</span>' : '';
    const planBudget = parsePlanBudget(c.budget);
    const capPct = planBudget > 0 ? (c.spend / planBudget * 100) : 0;
    const capStyle = capPct >= 100 ? 'color:#e74c3c;font-weight:bold' : capPct >= 80 ? 'color:#e67e22;font-weight:bold' : '';
    return `
    <tr>
      <td style="max-width:170px">${c.name}<br><span style="color:#888;font-size:11px">ID:${(c.id||'').slice(-8)}</span></td>
      <td>${c.trend} ${trendTag}</td>
      <td style="font-weight:bold">¥${c.spend.toFixed(2)}</td>
      <td style="color:${c.spendDelta>=0?'#e74c3c':'#27ae60'}">¥${(c.spendDelta||0).toFixed(2)}</td>
      <td style="color:${c.changeRate>=0?'#e74c3c':'#27ae60'}">${(c.changeRate>=0?'+':'')}${((c.changeRate||0)*100).toFixed(0)}%</td>
      <td>${c.conversions||0}</td>
      <td style="font-weight:bold;color:${c.cpa > summary.avgCPA * 1.3 ? '#e74c3c' : '#27ae60'}">¥${(c.cpa||0).toFixed(2)}</td>
      <td style="${capStyle}">${planBudget > 0 ? capPct.toFixed(0)+'%' : 'N/A'}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="refresh" content="900">
<title>极狐-区域福利号-直播 投放监控 ${today}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f7fa;color:#2c3e50;padding:20px}
.header{background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);color:#fff;padding:28px 36px;border-radius:14px;margin-bottom:22px}
.header h1{font-size:26px;margin-bottom:4px;letter-spacing:1px}
.header .sub{color:#a0aec0;font-size:13px;margin-top:6px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:22px}
.card{background:#fff;border-radius:10px;padding:18px 16px;box-shadow:0 2px 12px rgba(0,0,0,.06);transition:transform .15s}
.card:hover{transform:translateY(-2px)}
.card .label{font-size:11px;color:#95a5a6;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.card .value{font-size:24px;font-weight:700}
.card .subv{font-size:12px;color:#95a5a6;margin-top:4px}
.green{color:#27ae60}.red{color:#e74c3c}.blue{color:#2980b9}.orange{color:#e67e22}
.section{background:#fff;border-radius:10px;padding:22px 24px;margin-bottom:20px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
.section h2{font-size:17px;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #ecf0f1;display:flex;align-items:center;gap:8px}
.section h2 .count{font-size:12px;color:#94a3b8;font-weight:400}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{background:#f8fafc;padding:10px 8px;text-align:left;font-weight:600;border-bottom:2px solid #e2e8f0;white-space:nowrap;color:#64748b;font-size:11px}
td{padding:8px;border-bottom:1px solid #f1f5f9}
tr:hover{background:#f8faff}
.footer{text-align:center;color:#94a3b8;font-size:11px;margin-top:24px;padding:16px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600}
.bg-green{background:#dcfce7;color:#166534}.bg-red{background:#fee2e2;color:#991b1b}.bg-yellow{background:#fef9c3;color:#854d0e}.bg-blue{background:#dbeafe;color:#1e40af}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
.pulse{animation:pulse 2s infinite}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:768px){.grid2{grid-template-columns:1fr}}
.scroll-table{max-height:500px;overflow-y:auto}
</style>
</head>
<body>
<div class="header">
  <h1>🔥 极狐-区域福利号-直播 · 投放实时监控</h1>
  <div class="sub">更新时间: ${now} | 时段: ${d.timeSlot || 'N/A'} | 16h直播(7-23) | 有消耗 ${summary.totalSpending||0}条 · 投放中 ${summary.totalActive||0}条 · 起量 ${(rampingUp||[]).length} · 掉量 ${(dropping||[]).length} · 节奏 ${d.pacingHealth||'N/A'} | 冷启${d.lifecycle?.cold_start||0}·活跃${d.lifecycle?.active||0}·死亡${d.lifecycle?.dead||0} | 每15分钟自动刷新</div>
</div>

<div class="cards">
  <div class="card"><div class="label">有消耗计划</div><div class="value blue pulse">${summary.totalSpending||0}</div><div class="subv">投放中 ${summary.totalActive||0} · 暂停 ${summary.totalSpending - summary.totalActive}</div></div>
  <div class="card"><div class="label">今日消耗${summary.useAccountSpend ? '<span style="font-size:10px;color:#10b981">●账户</span>' : ''}</div><div class="value red">¥${summary.totalSpend.toFixed(0)}</div><div class="subv">理想 ¥${(d.idealSpend||0).toFixed(0)} | 15m +¥${(d.spendLast15min||0).toFixed(0)}</div></div>
  <div class="card"><div class="label">总转化 / CPL</div><div class="value green">${summary.totalConversions}</div><div class="subv">CPL ¥${summary.avgCPA.toFixed(0)}</div></div>
  <div class="card"><div class="label">近15m CPL</div><div class="value ${d.cplLast15min > 0 ? (d.cplLast15min > summary.avgCPA * 1.3 ? 'red' : 'green') : 'blue'}">${d.convLast15min === -1 ? '—' : d.cplLast15min > 0 ? '¥' + d.cplLast15min.toFixed(0) : '—'}</div><div class="subv">${d.convLast15min === -1 ? '数据不足' : d.convLast15min > 0 ? d.convLast15min + '条转化' : '无新增转化'}</div></div>
  <div class="card"><div class="label">消耗速度</div><div class="value orange">¥${(d.speedCurrent||0).toFixed(0)}/min</div><div class="subv">预估今日 ¥${(d.projectedDaily||0).toFixed(0)}</div></div>
  <div class="card"><div class="label">预算使用</div><div class="value ${(d.budgetUsed||0)>0.85?'red':'green'}">${((d.budgetUsed||0)*100).toFixed(0)}%</div><div class="subv">节奏: ${d.pacingHealth||'N/A'}</div></div>
  <div class="card"><div class="label">开口留资率</div><div class="value blue">${(summary.openRetainRate ? (summary.openRetainRate*100).toFixed(1)+'%' : 'N/A')}</div><div class="subv">开${summary.totalPrivateMsgOpen||0}→留${summary.totalPrivateMsgRetain||0}</div></div>
  <div class="card"><div class="label">私信开口</div><div class="value" style="color:#8b5cf6">${summary.totalPrivateMsgOpen||0}</div><div class="subv">条</div></div>
  <div class="card"><div class="label">私信留资</div><div class="value" style="color:#3b82f6">${summary.totalPrivateMsgRetain||0}</div><div class="subv">条</div></div>
  <div class="card"><div class="label">表单提交</div><div class="value" style="color:#10b981">${summary.totalFormSubmit||0}</div><div class="subv">条</div></div>
  ${summary.accountBudget > 0 ? `<div class="card"><div class="label">账户预算</div><div class="value ${summary.accountSpend / summary.accountBudget > 0.85 ? 'red' : 'green'}">¥${summary.accountSpend ? summary.accountSpend.toFixed(0) : '0'} / ¥${summary.accountBudget.toFixed(0)}</div><div class="subv">使用率 ${summary.accountSpend ? ((summary.accountSpend / summary.accountBudget)*100).toFixed(0) : 0}%</div></div>` : ''}
</div>

<!-- 转化漏斗 -->
<div class="section">
  <h2>📊 转化漏斗 <span class="count">线索来源对照</span></h2>
  ${funnelBar(summary.totalPrivateMsgOpen||0, '💬 私信开口', '#8b5cf6')}
  ${funnelBar(summary.totalPrivateMsgRetain||0, '📝 私信留资', '#3b82f6')}
  ${funnelBar(summary.totalFormSubmit||0, '📋 表单提交', '#10b981')}
  ${funnelBar(summary.totalLeads||0, '📌 线索数 (留资+表单)', '#f59e0b')}
  ${funnelBar(summary.totalConversions||0, '🎯 转化数 (≈线索)', '#ef4444')}
  <div style="margin-top:12px;font-size:12px;color:#64748b">
    开口→留资率: <b>${(summary.openRetainRate ? (summary.openRetainRate*100).toFixed(1)+'%' : 'N/A')}</b> · 
    私信留资 ${summary.totalPrivateMsgRetain||0} + 表单 ${summary.totalFormSubmit||0} ≈ 线索 ${summary.totalLeads||0} ≈ 转化 ${summary.totalConversions||0}
    ${Math.abs((summary.totalPrivateMsgRetain||0)+(summary.totalFormSubmit||0)-(summary.totalLeads||0)) > 5 
      ? '⚠️ <span style="color:#e67e22">留资+表单 与 线索数 有偏差，请核实</span>' : '✅ <span style="color:#27ae60">留资+表单 ≈ 线索</span>'}
    ${Math.abs((summary.totalLeads||0)-(summary.totalConversions||0)) > 5 
      ? ' · ℹ️ <span style="color:#636363">线索≠转化 (可能含直播停留/互动等浅层目标)</span>' : ' · ✅ <span style="color:#27ae60">线索 ≈ 转化</span>'}
  </div>
</div>

<!-- 告警 -->
<div class="section">
  <h2>⚠️ 异常告警 <span class="badge ${alerts.filter(a=>a.severity==='high').length>0?'bg-red':'bg-green'}">${alerts.length} 条</span></h2>
  <table>
    <thead><tr><th>类型/名称</th><th colspan="4">详情</th><th>级别</th></tr></thead>
    <tbody>${alertsHTML}</tbody>
  </table>
</div>

<!-- 全量计划表 -->
<div class="section">
  <h2>📋 全量计划明细 <span class="count">${(planList||[]).length} 条 · 有消耗 · 按消耗降序</span></h2>
  <div class="scroll-table">
  <table>
    <thead><tr><th>计划名称/ID</th><th>状态</th><th>消耗</th><th>CPL</th><th>转化</th><th>线索</th><th>私信留资</th><th>表单</th><th>开口</th><th>CTR</th><th>CVR</th><th>计划预算</th><th>周期</th></tr></thead>
    <tbody>${allPlanRows}</tbody>
  </table>
  </div>
</div>

<!-- 趋势分析 + 同比 + 生命周期 -->
<div class="section">
  <h2>📈 趋势洞察 <span class="count">滑动窗口 + 同比 + 生命周期</span></h2>
  <div class="grid2">
    <div>
      <h3 style="font-size:14px;margin-bottom:8px">滑动窗口趋势 (最近8周期)</h3>
      ${d.trends?.cpaTrend ? `<p style="font-size:13px;margin:4px 0"><b>CPA趋势:</b> 每周期变化 ¥${d.trends.cpaTrend.slope.toFixed(2)} · 变化率 ${(d.trends.cpaTrend.changeRate*100).toFixed(1)}% · ${d.trends.cpaTrend.changeRate > 0.08 ? '<span style="color:#e74c3c">⚠ 持续走高</span>' : '<span style="color:#27ae60">✅ 稳定</span>'}</p>` : '<p style="font-size:13px;color:#94a3b8">CPA趋势数据不足(需≥3周期)</p>'}
      ${d.trends?.spendTrend ? `<p style="font-size:13px;margin:4px 0"><b>消耗速度趋势:</b> 每周期变化 ¥${d.trends.spendTrend.slope.toFixed(2)} · 变化率 ${(d.trends.spendTrend.changeRate*100).toFixed(1)}% · ${d.trends.spendTrend.changeRate > 0.15 ? '<span style="color:#e67e22">⚠ 持续加速</span>' : '<span style="color:#27ae60">✅ 稳定</span>'}</p>` : '<p style="font-size:13px;color:#94a3b8">消耗趋势数据不足(需≥3周期)</p>'}
    </div>
    <div>
      <h3 style="font-size:14px;margin-bottom:8px">同比昨天同时段</h3>
      ${d.yoy ? `
        <p style="font-size:13px;margin:4px 0"><b>消耗:</b> 昨天 ¥${d.yoy.yesterdaySpend.toFixed(0)} → 今天 ¥${summary.totalSpend.toFixed(0)} 
        ${d.yoy.spendVsYesterday !== null ? `<span style="color:${d.yoy.spendVsYesterday >= 0 ? '#e74c3c':'#27ae60'}">${d.yoy.spendVsYesterday >= 0 ? '↑':'↓'}${Math.abs(d.yoy.spendVsYesterday*100).toFixed(0)}%</span>` : ''}</p>
        <p style="font-size:13px;margin:4px 0"><b>CPL:</b> 昨天 ¥${(d.yoy.yesterdayCPA||0).toFixed(0)} → 今天 ¥${(summary.avgCPA||0).toFixed(0)} 
        ${d.yoy.cpaVsYesterday !== null ? `<span style="color:${d.yoy.cpaVsYesterday >= 0 ? '#e74c3c':'#27ae60'}">${d.yoy.cpaVsYesterday >= 0 ? '↑':'↓'}${Math.abs(d.yoy.cpaVsYesterday*100).toFixed(0)}%</span>` : ''}</p>
      ` : '<p style="font-size:13px;color:#94a3b8">无昨天同时段数据</p>'}
    </div>
  </div>
  ${d.lifecycle ? `
  <div style="margin-top:12px;padding-top:10px;border-top:1px solid #e2e8f0">
    <h3 style="font-size:14px;margin-bottom:8px">🌱 计划生命周期分布</h3>
    <p style="font-size:13px">
      ${d.lifecycle.cold_start > 0 ? `<span style="color:#10b981">🌱 冷启动 ${d.lifecycle.cold_start}</span> · ` : ''}
      ${d.lifecycle.active > 0 ? `<span style="color:#3b82f6">🔥 活跃 ${d.lifecycle.active}</span> · ` : ''}
      ${d.lifecycle.declining > 0 ? `<span style="color:#e67e22">📉 衰退 ${d.lifecycle.declining}</span> · ` : ''}
      ${d.lifecycle.dead > 0 ? `<span style="color:#e74c3c">💀 疑似死亡 ${d.lifecycle.dead}</span>` : ''}
    </p>
  </div>` : ''}
</div>

<!-- 近15分钟新增消耗 TOP -->
<div class="section">
  <h2>📊 近15分钟新增消耗 TOP</h2>
  <table>
    <thead><tr><th>计划名称/ID</th><th>趋势</th><th>累计消耗</th><th>15m新增</th><th>环比变化</th><th>转化(条)</th><th>CPL</th><th>预算使用</th></tr></thead>
    <tbody>${campaignRows}</tbody>
  </table>
</div>

<!-- 起量 + 掉量 -->
<div class="grid2">
  <div class="section">
    <h2>🚀 起量 <span class="count">>30% | ${(rampingUp||[]).length}条</span></h2>
    <table>
      <thead><tr><th>计划</th><th>消耗</th><th>15m新增</th><th>环比</th><th>CPL</th></tr></thead>
      <tbody>${(rampingUp||[]).length > 0 ? (rampingUp||[]).map(c => `
      <tr>
        <td title="${c.name}">${c.name.slice(0, 22)}</td>
        <td>¥${c.spend.toFixed(0)}</td>
        <td style="color:#e74c3c">¥${(c.spendDelta||0).toFixed(0)}</td>
        <td style="color:#e74c3c">+${((c.changeRate||0)*100).toFixed(0)}%</td>
        <td>¥${(c.cpa||0).toFixed(0)}</td>
      </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:#94a3b8">暂无起量</td></tr>'}</tbody>
    </table>
  </div>
  <div class="section">
    <h2>📉 掉量 <span class="count"><-30% | ${(dropping||[]).length}条</span></h2>
    <table>
      <thead><tr><th>计划</th><th>消耗</th><th>15m新增</th><th>环比</th><th>CPL</th></tr></thead>
      <tbody>${(dropping||[]).length > 0 ? (dropping||[]).map(c => `
      <tr>
        <td title="${c.name}">${c.name.slice(0, 22)}</td>
        <td>¥${c.spend.toFixed(0)}</td>
        <td style="color:#27ae60">¥${(c.spendDelta||0).toFixed(0)}</td>
        <td style="color:#27ae60">${((c.changeRate||0)*100).toFixed(0)}%</td>
        <td>¥${(c.cpa||0).toFixed(0)}</td>
      </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:#94a3b8">暂无掉量</td></tr>'}</tbody>
    </table>
  </div>
</div>

<!-- 建议反馈记录 -->
<div class="section">
  <h2>📋 建议反馈记录 <span class="count">最近20条 | 采纳${history.summary?.accepted||0} / 拒绝${history.summary?.rejected||0} / 忽略${history.summary?.ignored||0}</span></h2>
  ${histRows ? `<div class="scroll-table"><table>
    <thead><tr><th>时间</th><th>类型</th><th>计划</th><th>建议</th><th>结果</th></tr></thead>
    <tbody>${histRows}</tbody>
  </table></div>` : '<p style="color:#94a3b8;padding:20px;text-align:center">暂无建议记录，将在首次推送后开始收集</p>'}
</div>

<div class="footer">
  WorkBuddy 自动监控 · ${today} · 巨量引擎 ${CONFIG.accountName} · 16h直播(7:00-23:00) · 环比T-15/30/60min · 每15分钟更新
  <br>建议反馈通过飞书卡片 是/否 按钮收集 · <a href="${CONFIG.feedbackBaseUrl}/history" style="color:#3b82f6">JSON历史</a> · <a href="oceanengine-daily-${today}.html" style="color:#10b981;font-weight:bold">📊 今日日报(23:05生成)</a>
</div>
</body>
</html>`;
}

function saveDailyLog(analysis) {
  const today = getLocalDate();
  const logFile = path.join(CONFIG.dataDir, `daily-${today}.json`);
  let log = [];
  if (fs.existsSync(logFile)) {
    try { log = JSON.parse(fs.readFileSync(logFile, 'utf-8')); } catch {}
  }
  log.push({
    time: new Date().toISOString(),
    totalSpending: analysis.summary.totalSpending,
    activeCount: analysis.summary.totalActive,
    totalSpend: analysis.summary.totalSpend,
    totalConversions: analysis.summary.totalConversions,
    avgCPA: analysis.summary.avgCPA,
    spendLast15min: analysis.delta?.spendLast15min || 0,
    speedCurrent: analysis.delta?.speedCurrent || 0,
    budgetUsed: analysis.delta?.budgetUsed || 0,
    rampingUp: (analysis.rampingUp || []).length,
    dropping: (analysis.dropping || []).length,
    alertCount: analysis.alerts.length,
    alertTypes: [...new Set(analysis.alerts.map(a => a.type))],
    // 账户级数据
    accountSpend: analysis.summary.accountSpend ?? null,
    accountBudget: analysis.summary.accountBudget ?? null,
    accountBalance: analysis.summary.accountBalance ?? null,
    // 趋势数据
    timeSlot: analysis.delta?.timeSlot || '',
    pacingHealth: analysis.delta?.pacingHealth || '',
    lifecycle: analysis.delta?.lifecycle || {},
    yoy: analysis.delta?.yoy || null,
    totalLeads: analysis.summary.totalLeads || 0,
    openRetainRate: analysis.summary.openRetainRate || 0,
    convLast15min: analysis.delta?.convLast15min || 0,
    cplLast15min: analysis.delta?.cplLast15min || 0,
    // 直播间 + 效率指标 (新增，供多日基线使用)
    avgCPM: analysis.summary.avgCPM || 0,
    viewRetention: analysis.summary.viewRetention || 0,
    convEfficiency: analysis.summary.convEfficiency || 0,
    totalLiveViews: analysis.summary.totalLiveViews || 0,
    totalLiveOver1Min: analysis.summary.totalLiveOver1Min || 0,
  });
  atomicWriteJSON(logFile, log);
}

// ====== 飞书机器人推送 ======
// 飞书推送分级路由
// Level 1: 严重告警 → 立即推送 (跳过频率限制)
// Level 2: 中等告警 → 10分钟间隔
// Level 3: 正常 → 仅更新HTML报表, 不推送飞书卡片
// Level 4: HTML报表 每15分钟有更新, 通过 browser refresh 查看
function shouldPush(analysis) {
  const highCount = analysis.alerts.filter(a => a.severity === 'high').length;
  const midCount = analysis.alerts.filter(a => a.severity === 'medium').length;

  // Level 1: 严重告警 → 立即推送
  if (highCount > 0) return { push: true, level: 1, reason: `严重告警 ${highCount} 条` };

  // Level 2: 中等告警 → 立即推送
  if (midCount > 0) return { push: true, level: 2, reason: `中等告警 ${midCount} 条` };

  // Level 3: 无告警 → 每15分钟常规推送
  return { push: true, level: 3, reason: '常规15分钟播报' };
}

// 构建飞书交互式卡片消息（v3：反馈按钮 + 历史参考 + 16h窗口）
function buildFeishuCard(analysis) {
  const { summary, alerts, topNewSpenders, rampingUp, dropping, delta } = analysis;
  const now = new Date().toLocaleString('zh-CN');
  const d = delta || {};
  const hasAlerts = alerts.length > 0;
  const highAlerts = alerts.filter(a => a.severity === 'high');
  const midAlerts = alerts.filter(a => a.severity === 'medium');
  
  // ====== 加载建议历史，过滤应抑制的告警 ======
  const history = loadSuggestionHistory();
  markIgnoredSuggestions(); // 标记过期的未回复建议
  
  const actionAlerts = alerts.filter(a => {
    if (a.type !== 'zero_conv' && a.type !== 'high_cpa' && a.type !== 'budget_cap') return false;
    const check = shouldSuggest(a.type, a.campaignId, history);
    return check.suggest;
  });
  const watchAlerts = alerts.filter(a => a.type === 'cpa_3h' || a.type === 'speed_3h' || a.type === 'conv_drop_3h' || a.type === 'burn_accel_3h' || a.type === 'cpa_vs_3d' || a.type === 'spend_vs_3d' || a.type === 'conv_vs_3d' || a.type === 'plan_count_drop' || a.type === 'retain_rate_drop' || a.type === 'cpm_spike' || a.type === 'view_retention_drop' || a.type === 'conv_efficiency_drop' || a.type === 'compound_risk' || a.type === 'cpa_trend' || a.type === 'spend_trend' || a.type === 'account_budget_cap');
  const infoAlerts = alerts.filter(a => a.type === 'speed_spike' || a.type === 'budget' || a.type === 'pacing_fast' || a.type === 'pacing_slow' || a.type === 'dead_plan' || a.type === 'dropping');
  const zeroConvAlerts = actionAlerts.filter(a => a.type === 'zero_conv');
  
  // 卡片头部
  const headerColor = hasAlerts ? (highAlerts.length > 0 ? 'red' : 'orange') : 'green';
  const statusIcon = highAlerts.length > 0 ? '🔴' : midAlerts.length > 0 ? '🟡' : '✅';
  const alertSummary = hasAlerts
    ? `${alerts.length}条告警 (待处理${actionAlerts.length}条)`
    : '运行正常';

  // ====== Section 1: 消耗节奏 ======
  const timePct = d.timeProgress > 0 ? (d.timeProgress * 100).toFixed(0) : '0';
  const budgetPct = d.budgetUsed > 0 ? (d.budgetUsed * 100).toFixed(0) : '0';
  const timeBar = progressBar(Number(timePct));
  const spendBar = progressBar(Number(budgetPct));

  const pacingLabel = d.pacingHealth === 'good' ? '✅ 消耗节奏正常'
    : d.pacingHealth === 'warning' ? '⚠️ 消耗节奏偏离' : '🔴 消耗节奏异常';

  const projectedStr = d.timeProgress >= 1
    ? `投放已结束 · 实际 ¥${(summary.totalSpend || 0).toFixed(0)}`
    : `预估今日 ¥${d.projectedDaily.toFixed(0)} | 剩余 ${d.windowDuration - (d.elapsedHours || 0) > 0 ? (d.windowDuration - d.elapsedHours).toFixed(1) + 'h' : '0h'}`;

  const pacingLines = [
    `${timeBar} ${timePct}%  (已过${(d.elapsedHours||0).toFixed(1)}h/${d.windowDuration||16}h)`,
    `${spendBar} ${budgetPct}%  (¥${(summary.totalSpend||0).toFixed(0)} / ¥${d.dailyBudget||45000})`,
    `📊 ${pacingLabel} | ${d.timeSlot || ''}`,
    `🎯 ${projectedStr}`,
  ];

  // ====== Section 2: 核心指标 ======
  const speedChange = d.speedHour > 0 ? ((d.speedCurrent / d.speedHour - 1) * 100).toFixed(0) : '—';
  const speedEmoji = speedChange === '—' ? '' : Number(speedChange) > 30 ? '🔥' : Number(speedChange) > 10 ? '⬆' : Number(speedChange) < -20 ? '⬇' : '';
  const cpaChange = d.prevCPA30 > 0 ? ((summary.avgCPA / d.prevCPA30 - 1) * 100).toFixed(0) : '—';
  const cpaEmoji = cpaChange === '—' ? '' : Number(cpaChange) > 10 ? '📈' : Number(cpaChange) < -10 ? '📉' : '';

  const metricsLines = [
    `💰 **消耗**: ¥${summary.totalSpend.toFixed(0)}${summary.useAccountSpend ? ' (账户)' : ''} | 近15m +¥${d.spendLast15min.toFixed(0)}`,
    `🎯 **转化**: ${summary.totalConversions}条 | CPL ¥${summary.avgCPA.toFixed(0)}${cpaEmoji ? ' ' + cpaEmoji : ''}`,
    `📊 **近15m CPL**: ${d.convLast15min === -1 ? '数据不足(快照过旧)' : d.convLast15min > 0 ? '¥' + d.cplLast15min.toFixed(0) + ' (' + d.convLast15min + '条转化)' : '— (无新增转化)'}`,
    `📈 **CPM**: ¥${(summary.avgCPM||0).toFixed(1)} | 停留率 ${summary.viewRetention ? (summary.viewRetention*100).toFixed(1)+'%' : 'N/A'} (${summary.totalLiveOver1Min||0}/${summary.totalLiveViews||0})`,
    `📨 **转化漏斗**: 开口${summary.totalPrivateMsgOpen||0}条 → 留资${summary.totalPrivateMsgRetain||0}条 + 表单${summary.totalFormSubmit||0}条 → 线索${summary.totalLeads||0}条 ≈ 转化${summary.totalConversions}条 | 开留率${(summary.openRetainRate ? (summary.openRetainRate*100).toFixed(1) + '%' : 'N/A')}`,
    `⚡ **速度**: ¥${d.speedCurrent.toFixed(0)}/min${speedEmoji} | 有消耗 ${summary.totalSpending}条 · 投放中 ${summary.totalActive}条 (起量${rampingUp.length}·掉量${dropping.length})`,
    ...(summary.accountBudget > 0 ? [`🏦 **账户预算**: ¥${(summary.accountSpend||0).toFixed(0)} / ¥${summary.accountBudget.toFixed(0)} (${((summary.accountSpend||0)/summary.accountBudget*100).toFixed(0)}%)`] : []),
  ];

  // ====== 多日对比 (追加到metricsLines) ======
  const yoyCard = d.yoy;
  const multiDayCard = analysis._multiDay;
  if (yoyCard || multiDayCard) {
    const ydLines = [];
    if (yoyCard && yoyCard.yesterdaySpend > 0) {
      const spendVs = yoyCard.spendVsYesterday !== null ? (yoyCard.spendVsYesterday >= 0 ? '+' : '') + (yoyCard.spendVsYesterday * 100).toFixed(0) + '%' : '—';
      const cpaVs = yoyCard.cpaVsYesterday !== null ? (yoyCard.cpaVsYesterday >= 0 ? '+' : '') + (yoyCard.cpaVsYesterday * 100).toFixed(0) + '%' : '—';
      ydLines.push(`📅 **昨日同时段**: 消耗 ¥${yoyCard.yesterdaySpend.toFixed(0)} (${spendVs}) · CPL ¥${yoyCard.yesterdayCPA.toFixed(0)} (${cpaVs}) · ${yoyCard.yesterdayConversions}条转化`);
    }
    if (multiDayCard && multiDayCard.sampleDays >= 2) {
      const spendVsMean = multiDayCard.spend.mean > 0 ? ((summary.totalSpend / multiDayCard.spend.mean - 1) * 100).toFixed(0) : '—';
      const cpaVsMean = multiDayCard.cpa && multiDayCard.cpa.mean > 0 ? ((summary.avgCPA / multiDayCard.cpa.mean - 1) * 100).toFixed(0) : '—';
      ydLines.push(`📊 **近${multiDayCard.sampleDays}天同时段**: 消耗均值 ¥${multiDayCard.spend.mean.toFixed(0)} (${spendVsMean >= 0 ? '+' : ''}${spendVsMean}%) · CPL均值 ¥${(multiDayCard.cpa?.mean||0).toFixed(0)} (${cpaVsMean >= 0 ? '+' : ''}${cpaVsMean}%)`);
    }
    if (ydLines.length > 0) {
      metricsLines.push('');
      metricsLines.push(...ydLines);
    }
  }

  // ====== Section 3: 告警内容 ======
  const alertLines = [];
  if (actionAlerts.length > 0) {
    alertLines.push('🔴 **需处理** (请点击下方按钮反馈)');
    for (const a of actionAlerts) {
      alertLines.push(`${a.type === 'zero_conv' ? '⛔' : a.type === 'budget_cap' ? '📊' : '💸'} ${a.name}: ${a.detail}`);
    }
  }
  if (watchAlerts.length > 0) {
    if (alertLines.length > 0) alertLines.push('');
    alertLines.push('🟡 **需关注**');
    for (const a of watchAlerts) {
      const emoji = a.type.includes('cpa') ? '📈' : a.type.includes('speed') ? '⚡' : a.type.includes('conv') ? '📉' : a.type.includes('spend') ? '💰' : a.type.includes('plan') ? '📋' : a.type.includes('retain') ? '📨' : a.type.includes('cpm') ? '📊' : a.type.includes('view') ? '👁' : a.type.includes('compound') ? '⚠️' : '🏦';
      alertLines.push(`${emoji} ${a.name}: ${a.detail}`);
    }
  }
  if (infoAlerts.length > 0) {
    if (alertLines.length > 0) alertLines.push('');
    alertLines.push('🔵 **节奏提醒**');
    for (const a of infoAlerts) {
      alertLines.push(`ℹ ${a.name}: ${a.detail}`);
    }
  }
  if (alertLines.length === 0) {
    alertLines.push('✅ 消耗平稳，成本可控，所有计划运行正常');
  }

  // ====== Section 4: TOP新增消耗 + 趋势 ======
  const topLines = [];
  if (topNewSpenders.length > 0) {
    topLines.push('📊 **近15分钟新增消耗 TOP5**');
    const trendTag = (t) => {
      if (t === '起量') return '🔥'; if (t === '掉量') return '📉';
      if (t === '稳定消耗') return '➡'; return '';
    };
    for (let i = 0; i < Math.min(5, topNewSpenders.length); i++) {
      const c = topNewSpenders[i];
      const rateStr = c.spendPrev > 0.01 ? `${(c.changeRate >= 0 ? '+' : '')}${(c.changeRate * 100).toFixed(0)}%` : 'NEW';
      topLines.push(`${i + 1}. ${trendTag(c.trend)} ${c.name.slice(0, 18)} — ¥${c.spendDelta.toFixed(0)} (${rateStr}) · CPL ¥${c.cpa.toFixed(0)}`);
    }
  }

  // ====== Build Elements ======
  const elements = [];

  // --- 消耗节奏 ---
  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: pacingLines.join('\n') }
  });
  elements.push({ tag: 'hr' });

  // --- 核心指标 ---
  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: metricsLines.join('\n') }
  });
  elements.push({ tag: 'hr' });

  // --- 告警 ---
  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: alertLines.join('\n') }
  });

  // ====== 可执行建议的 是/否 按钮 ======
  const feedbackServerUp = (() => {
    try { const r = execSync(`curl -s http://127.0.0.1:${CONFIG.feedbackPort}/health`, { timeout: 2000, encoding: 'utf-8' }); return r.includes('"ok":true'); }
    catch { return false; }
  })();
  const pendingSuggestions = [];
  
  if (actionAlerts.length > 0 && feedbackServerUp) {
    elements.push({ tag: 'hr' });
    
    for (const a of actionAlerts) {
      const alertId = `sug_${Date.now()}_${a.type}_${(a.campaignId||'').slice(-6)}`;
      const shortName = (a.name || '').replace(/^(零转化消耗|高成本计划|已撞线暂停|预算即将耗尽):\s*/, '').slice(0, 16);
      const encodedName = encodeURIComponent(shortName);
      const encodedCampaignId = encodeURIComponent(a.campaignId || '');
      
      const isBudgetCapHit = a.type === 'budget_cap' && a.severity === 'high'; // 阶梯2: 已撞线(≥100%)
      
      pendingSuggestions.push({
        id: alertId,
        alertType: a.type,
        campaignId: a.campaignId || '',
        campaignName: shortName,
        suggestion: a.type === 'zero_conv' ? `暂停 ${shortName}` : a.type === 'high_cpa' ? `关停 ${shortName}` : isBudgetCapHit ? `恢复并追加预算 ${shortName}` : `追加预算 ${shortName}`,
        timeSlot: d.timeSlot || '',
      });
      
      // 建议标签 + 是/否按钮
      const actionLabel = a.type === 'zero_conv' ? '建议暂停' : a.type === 'high_cpa' ? '建议关停' : isBudgetCapHit ? '建议恢复并追加' : '建议追加预算';
      const detailLabel = a.type === 'zero_conv'
        ? `${shortName} · 消耗¥${a.detail?.match(/¥([\d,]+)/)?.[1] || '?'}零转化`
        : a.type === 'high_cpa'
        ? `${shortName} · CPA超均值`
        : isBudgetCapHit
        ? `${shortName} · 已撞线暂停`
        : `${shortName} · 预算即将耗尽`;
      
      elements.push({
        tag: 'div',
        text: { tag: 'lark_md', content: `**${actionLabel}**  「${detailLabel}」` }
      });
      
      elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'lark_md', content: '✅ 是，执行' },
            url: `${CONFIG.feedbackBaseUrl}/feedback?action=accept&alertId=${alertId}&type=${a.type}&campaignId=${encodedCampaignId}&name=${encodedName}`,
            type: 'primary',
          },
          {
            tag: 'button',
            text: { tag: 'lark_md', content: '❌ 否，跳过' },
            url: `${CONFIG.feedbackBaseUrl}/feedback?action=reject&alertId=${alertId}&type=${a.type}&campaignId=${encodedCampaignId}&name=${encodedName}`,
            type: 'default',
          }
        ]
      });
    }
  } else if (actionAlerts.length > 0 && !feedbackServerUp) {
    // 反馈服务器未运行时的降级提示
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: '💡 以上建议需要你判断是否执行，反馈服务器暂未启动，按钮不可用' }
    });
  }

  // --- TOP消耗 ---
  if (topLines.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: topLines.join('\n') }
    });
  }

  // --- 起量/掉量摘要 ---
  if (rampingUp.length > 0 || dropping.length > 0) {
    const trendLines = [];
    if (rampingUp.length > 0) trendLines.push(`🔥 起量: ${rampingUp.slice(0, 3).map(c => c.name.slice(0, 12) + '+' + (c.changeRate*100).toFixed(0) + '%').join(', ')}`);
    if (dropping.length > 0) trendLines.push(`📉 掉量: ${dropping.slice(0, 3).map(c => c.name.slice(0, 12) + (c.changeRate*100).toFixed(0) + '%').join(', ')}`);
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: trendLines.join('\n') }
    });
  }

  // --- 同比基线 (昨天同时段) ---
  if (d.yoy) {
    elements.push({ tag: 'hr' });
    const yoySpendStr = d.yoy.spendVsYesterday !== null 
      ? `${d.yoy.spendVsYesterday >= 0 ? '↑' : '↓'}${Math.abs(d.yoy.spendVsYesterday * 100).toFixed(0)}%`
      : '无数据';
    const yoyCPAStr = d.yoy.cpaVsYesterday !== null
      ? `${d.yoy.cpaVsYesterday >= 0 ? '↑' : '↓'}${Math.abs(d.yoy.cpaVsYesterday * 100).toFixed(0)}%`
      : '无数据';
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `📅 **同比昨天同时段** (${d.yoy.yesterdayDate || ''})\n消耗: ¥${d.yoy.yesterdaySpend.toFixed(0)} → ¥${summary.totalSpend.toFixed(0)} (${yoySpendStr}) | CPL: ¥${(d.yoy.yesterdayCPA||0).toFixed(0)} → ¥${(summary.avgCPA||0).toFixed(0)} (${yoyCPAStr})` }
    });
  }

  // --- 计划生命周期 ---
  if (d.lifecycle && (d.lifecycle.cold_start > 0 || d.lifecycle.dead > 0)) {
    elements.push({ tag: 'hr' });
    const lcParts = [];
    if (d.lifecycle.cold_start > 0) lcParts.push(`🌱 冷启动 ${d.lifecycle.cold_start}`);
    if (d.lifecycle.active > 0) lcParts.push(`🔥 活跃 ${d.lifecycle.active}`);
    if (d.lifecycle.declining > 0) lcParts.push(`📉 衰退 ${d.lifecycle.declining}`);
    if (d.lifecycle.dead > 0) lcParts.push(`💀 疑似死亡 ${d.lifecycle.dead}`);
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `🔄 **计划生命周期**: ${lcParts.join(' · ')}` }
    });
  }

  // --- 时段建议 ---
  elements.push({ tag: 'hr' });
  const advice = getTimeSlotAdvice(d.timeSlot, d.budgetUsed, (rampingUp||[]).length, (dropping||[]).length);
  if (advice) {
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `💡 **盯盘建议**: ${advice}` }
    });
  }

  // --- 建议历史洞察 ---
  const insight = getSuggestionInsight(history);
  if (insight) {
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: insight }
    });
  }

  // --- 底部按钮：仅保留 HTML 报表 ---
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'action',
    actions: [
      {
        tag: 'button',
        text: { tag: 'lark_md', content: feedbackServerUp ? '📊 查看详实报表' : '📊 报表 (需启动服务)' },
        url: feedbackServerUp ? `${CONFIG.feedbackBaseUrl}/report` : `file:///E:/炼丹炉/WorkBuddy/2026-06-11-08-56-59/oceanengine-report.html`,
        type: 'primary',
      }
    ]
  });

  // --- 脚注 ---
  elements.push({
    tag: 'note',
    elements: [
      { tag: 'plain_text', content: `🕐 ${now} · ${d.timeSlot || ''} · 16h直播(7-23) · 每15分钟更新 · 点击按钮反馈建议` }
    ]
  });

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${statusIcon} 极狐直播 · ${alertSummary}${d.timeSlot ? ' · ' + d.timeSlot : ''}` },
      template: headerColor
    },
    elements: elements,
    _pendingSuggestions: pendingSuggestions, // 内部字段，供 sendFeishuPush 使用
  };
}

// 进度条工具
function progressBar(pct) {
  const total = 10;
  const filled = Math.round(pct / 100 * total);
  return '█'.repeat(filled) + '░'.repeat(total - filled);
}

// 时段盯盘建议 (16h: 7-23)
function getTimeSlotAdvice(timeSlot, budgetUsed, rampingCount, droppingCount) {
  const advices = {
    '冷启动期': '⏳ 检查各计划是否开始消耗，关注冷启动失败的0消耗计划，适当给量激活',
    '早高峰': '📈 流量上升期，关注CPA趋势，发现起量计划可适当放量，掉量计划及时补量',
    '午高峰': '🔥 全天流量高峰，盯紧TOP消耗计划的CPA，超过均值1.5x立即暂停，预算消耗应达40%',
    '午后平稳期': '🔍 清理零转化和高成本计划，观察掉量计划是否需要调整出价或定向，预算消耗应达55%',
    '晚高峰': '🌇 晚间流量回升，竞争加剧，注意CPA波动，保持核心计划稳定投放',
    '夜间收尾': budgetUsed > 0.90
      ? '⚡ 预算即将耗尽，控制消耗节奏，优先保高转化计划，预留余量应对突发'
      : budgetUsed > 0.75
      ? '🎯 预算使用中后段，关注高消耗低转化计划，夜间成本波动大需紧盯'
      : '🌙 关键收尾阶段，确保核心计划正常投放，预留10-15%预算应对夜场流量',
    '已结束': `📊 今日投放已结束，消耗 ${(budgetUsed*100).toFixed(0)}%，复盘高成本计划为明日优化做准备`,
  };
  return advices[timeSlot] || '';
}

async function sendFeishuPush(analysis) {
  if (!CONFIG.larkCli) {
    console.log('  ⚠ lark-cli 不可用，跳过飞书推送');
    return false;
  }

  const check = shouldPush(analysis);
  if (!check.push) {
    console.log(`  📨 飞书推送跳过: ${check.reason}`);
    return false;
  }

  // 确保反馈服务器运行
  await guardFeedbackServer();

  const cardObj = buildFeishuCard(analysis);
  const pending = cardObj._pendingSuggestions || [];
  delete cardObj._pendingSuggestions; // 移除内部字段
  const cardJson = JSON.stringify(cardObj);

  // lark-cli: 直接调用 .exe（绕过 .cmd 的 shell 引号问题）
  try {
    // 如果 findLarkCli 找到 .exe，直接用 spawnSync（不经过 shell，引号安全）
    const isExe = CONFIG.larkCli.endsWith('.exe');
    const larkCmd = isExe ? CONFIG.larkCli
      : CONFIG.larkCli.endsWith('.ps1') ? CONFIG.larkCli.replace(/\.ps1$/, '.cmd')
      : CONFIG.larkCli.endsWith('.cmd') ? CONFIG.larkCli
      : CONFIG.larkCli + '.cmd';

    let result;
    if (isExe) {
      // .exe 直接调用，JSON 作为参数传递，无 shell 引号问题
      result = spawnSync(larkCmd, [
        'im', '+messages-send',
        '--chat-id', CONFIG.feishuChatId,
        '--msg-type', 'interactive',
        '--content', cardJson
      ], { timeout: 15000, encoding: 'utf-8', windowsHide: true });
    } else {
      // .cmd fallback: 通过 PowerShell 读取临时文件传递
      const tmpFile = path.join(CONFIG.dataDir, '_push-card.json');
      fs.writeFileSync(tmpFile, cardJson, 'utf-8');
      const psScript = `
$cardJson = Get-Content -Path '${tmpFile.replace(/'/g, "''")}' -Raw -Encoding UTF8
& '${larkCmd.replace(/'/g, "''")}' im +messages-send --chat-id ${CONFIG.feishuChatId} --msg-type interactive --content $cardJson
`;
      const psFile = path.join(CONFIG.dataDir, '_push-card.ps1');
      fs.writeFileSync(psFile, psScript, 'utf-8');
      result = spawnSync('powershell.exe', [
        '-ExecutionPolicy', 'Bypass',
        '-NoProfile',
        '-File', psFile
      ], { timeout: 20000, encoding: 'utf-8', windowsHide: true });
    }

    if (result.error) throw result.error;
    const stdout = (result.stdout || '').trim();
    const parsed = JSON.parse(stdout);
    if (parsed.ok) {
      const levelTag = check.level === 1 ? '🔴严重' : '🟡中等';
      console.log(`  📨 飞书推送成功 [${levelTag} L${check.level}]`);
      // 记录本次推送的待处理建议
      if (pending.length > 0) {
        recordPendingSuggestions(pending);
        console.log(`  📋 已记录 ${pending.length} 条待处理建议`);
      }

      // 严重告警时附送页面截图
      if (check.level === 1) {
        const imgPath = path.join(CONFIG.reportDir, 'oceanengine-latest.png');
        if (fs.existsSync(imgPath)) {
          try {
            const imgResult = spawnSync(CONFIG.larkCli.endsWith('.exe') ? CONFIG.larkCli : larkCmd, [
              'im', '+messages-send',
              '--chat-id', CONFIG.feishuChatId,
              '--msg-type', 'image',
              '--image', imgPath
            ], { timeout: 15000, encoding: 'utf-8', windowsHide: true });
            if (!imgResult.error) {
              const imgOut = JSON.parse((imgResult.stdout || '{}').trim());
              if (imgOut.ok) console.log('  🖼 截图附送成功');
              else console.log('  ⚠ 截图附送失败');
            }
          } catch { console.log('  ⚠ 截图附送失败'); }
        }
      }

      return true;
    } else {
      console.log(`  ⚠ 飞书推送失败: ${parsed.error?.message || stdout}`);
      return false;
    }
  } catch (e) {
    console.log(`  ❌ 飞书推送异常: ${e.message}`);
    return false;
  }
}

// ====== 主流程 ======
async function main() {
  const startTime = Date.now();

  // ====== 0.0 清空本轮日志 ======
  try { fs.writeFileSync(LOG_FILE, `[${new Date().toLocaleString()}]\n`); } catch {}

  // ====== 0. 时间窗口检查 ======
  const hour = new Date().getHours();
  if (hour < CONFIG.dailyStartHour || hour > CONFIG.dailyEndHour) {
    console.log(`[${new Date().toLocaleTimeString()}] ⓪ 不在直播窗口 (${hour}:00，窗口 ${CONFIG.dailyStartHour}:00-${CONFIG.dailyEndHour}:00)，静默退出`);
    process.exit(0);
  }

  console.log(`\n[${new Date().toLocaleTimeString()}] 🚀 巨量引擎监控启动 (v3)`);

  // ====== 1. Chrome 9222 检查 + 自动拉起 ======
  const chromeAlive = await checkChrome();
  if (!chromeAlive) {
    console.log('  ❌ Chrome 9222 端口未开启');
    const launched = await launchChrome();
    if (!launched) {
      console.log('  ⛔ Chrome 自动拉起失败，记录数据断层');
      recordDataGap('Chrome未运行且自动拉起失败');
      process.exit(1);
    }
    // Chrome 刚拉起，等待页面完全加载
    await sleep(8000);
  }

  if (!fs.existsSync(CONFIG.dataDir)) fs.mkdirSync(CONFIG.dataDir, { recursive: true });
  
  let client;
  const tab = await getTab('投放管理');
  if (tab) {
    console.log(`  使用标签页: ${tab.title}`);
    client = await connect(tab.webSocketDebuggerUrl);
  } else {
    console.log('  无投放管理标签页，从工作台导航');
    const accountTab = await getTab('巨量引擎工作台');
    if (!accountTab) { console.error('找不到巨量引擎标签页'); process.exit(1); }
    client = await connect(accountTab.webSocketDebuggerUrl);
    await client.send('Page.enable', {}); await client.send('Runtime.enable', {}); await sleep(200);
    await client.send('Page.navigate', { url: CONFIG.campaignUrl });
    await sleep(6000);
    await closePopups(client); await sleep(1000);
  }
  
  await client.send('Page.enable', {}); await client.send('Runtime.enable', {}); await sleep(200);
  
  // 如果是从已有标签页打开，强制刷新确保数据最新
  if (tab) {
    await closePopups(client); await sleep(300);
    // 强制刷新页面获取最新数据（忽略缓存）
    console.log('  强制刷新页面 (location.reload)...');
    await client.send('Runtime.evaluate', {
      expression: 'location.reload(true)',
      returnByValue: false
    });
    await sleep(5000); // 等待页面重新加载
    await closePopups(client); await sleep(500);
  }
  
  // 设置页面大小为50条
  await setPageSize(client, 50);
  
  // 按消耗降序排序
  await sortBySpend(client);
  
  // 抓取数据（智能全分页：逐页抓取直到没有有消耗的计划）
  console.log('  📥 抓取数据...');
  const result = await scrapeOnePage(client);
  let campaigns = result.campaigns || [];
  let accountSpend = result.accountSpend || 0;
  let accountBudget = result.accountBudget || 0;
  let accountBalance = result.accountBalance || 0;
  console.log(`  📊 第1页: ${campaigns.length} 条计划 | 账户消耗: ¥${accountSpend} | 账户预算: ¥${accountBudget} | 余额: ¥${accountBalance}`);
  
  // 逐页抓取直到没有有消耗计划或没有下一页
  let pageCount = 1;
  const MAX_PAGES = 10; // 安全上限
  while (pageCount < MAX_PAGES) {
    if (!(await hasNextPage(client))) break;
    
    pageCount++;
    console.log(`  📄 检测到第${pageCount}页，继续抓取...`);
    await clickNextPage(client);
    const nextResult = await scrapeOnePage(client);
    const nextCampaigns = nextResult.campaigns || [];
    console.log(`  📊 第${pageCount}页: ${nextCampaigns.length} 条计划`);
    
    // 只保留有消耗的活跃计划
    const activeNext = nextCampaigns.filter(c => c.spend > 0);
    if (activeNext.length > 0) {
      console.log(`  ➕ 合并 ${activeNext.length} 条有消耗计划`);
      campaigns = [...campaigns, ...activeNext];
    } else {
      console.log(`  ⏹ 第${pageCount}页无消耗计划，停止分页`);
      break;
    }
    
    // 如果第一页没抓到账户数据，用后续页的
    if (accountSpend === 0 && nextResult.accountSpend > 0) accountSpend = nextResult.accountSpend;
    if (accountBudget === 0 && nextResult.accountBudget > 0) accountBudget = nextResult.accountBudget;
  }
  
  if (pageCount >= MAX_PAGES) {
    console.log(`  ⚠ 已达最大分页数 ${MAX_PAGES}，停止抓取`);
  }
  
  console.log(`  📦 总计合并: ${campaigns.length} 条有消耗计划 (${pageCount}页)`);
  
  // 分析 (传入账户级数据和页面汇总行)
  const analysis = analyzeData(campaigns, accountSpend, accountBudget, accountBalance, result.pageSummary);
  
  // 保存完整数据
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const jsonFile = path.join(CONFIG.dataDir, `${timestamp}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify(analysis, null, 2));
  
  // 每日趋势日志
  saveDailyLog(analysis);
  
  // 生成报表
  const html = generateHTML(analysis);
  const htmlFile = path.join(CONFIG.reportDir, 'oceanengine-report.html');
  fs.writeFileSync(htmlFile, html);
  
  // 截图 (与后续处理并行)
  const screenshotPromise = (async () => {
    try {
      const ss = await client.send('Page.captureScreenshot', { format: 'png' });
      if (ss?.result?.data) {
        fs.writeFileSync(path.join(CONFIG.reportDir, 'oceanengine-latest.png'), Buffer.from(ss.result.data, 'base64'));
      }
    } catch {}
  })();
  
  client.close();
  
  // 等待截图完成
  await screenshotPromise;
  
  // 控制台输出
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const s = analysis.summary;
  const d = analysis.delta || {};
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  📊 极狐-区域福利号-直播 监控摘要  ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  有消耗: ${String(s.totalSpending).padStart(4)}  投放中: ${String(s.totalActive).padStart(3)}  起量: ${String((analysis.rampingUp||[]).length).padStart(3)}  掉量: ${String((analysis.dropping||[]).length).padStart(3)}  ║`);
  const statusStr = (s.statusLabels || []).map(l => `${l.label}${l.count}`).join(' ');
  if (statusStr) console.log(`║  状态分布: ${statusStr.padEnd(49)}  ║`);
  console.log(`║  总消耗: ¥${s.totalSpend.toFixed(0).padStart(12)}  (${s.spendSource === 'account' ? '账户' : s.spendSource === 'all_plans' ? '含暂停' : '仅活跃'})  ║`);
  console.log(`║  15m新增: ¥${(d.spendLast15min||0).toFixed(0).padStart(10)}             ║`);
  console.log(`║  总转化: ${String(s.totalConversions).padStart(6)}条  CPL: ¥${s.avgCPA.toFixed(2).padStart(8)}     ║`);
  console.log(`║  近15m: ${d.convLast15min === -1 ? '数据不足'.padStart(8) : String(d.convLast15min||0).padStart(4) + '条转化'}  ${d.convLast15min === -1 ? ''.padStart(10) : '15m CPL: ¥' + (d.cplLast15min||0).toFixed(2).padStart(8)}   ║`);
  
  // 3h窗口摘要
  const window3hData = analysis._window3h;
  if (window3hData) {
    const s3h = window3hData;
    const spdTag = s3h.speed.change > 0.3 ? '🔥' : s3h.speed.change < -0.3 ? '❄' : '➡';
    const cpaTag = s3h.cpa.change > 0.15 ? '📈' : s3h.cpa.change < -0.15 ? '📉' : '➡';
    console.log(`║  3h波动: 速度${spdTag}${(s3h.speed.change>=0?'+':'')}${(s3h.speed.change*100).toFixed(0)}% | CPL${cpaTag}${(s3h.cpa.change>=0?'+':'')}${(s3h.cpa.change*100).toFixed(0)}% | 燃速${(s3h.burnRate.second/1000).toFixed(1)}k/h    ║`);
  }
  
  // 多日对比
  const multiDayData = analysis._multiDay;
  if (multiDayData && multiDayData.sampleDays >= 2) {
    const md = multiDayData;
    const sVs = `vs均值${(md.spend.mean||0).toFixed(0)}`.padStart(14);
    const cVs = md.cpa ? `vs均值${(md.cpa.mean||0).toFixed(0)}`.padStart(12) : '';
    console.log(`║  近${md.sampleDays}天: 消耗${sVs} | CPL${cVs}           ║`);
  }
  
  console.log(`║  线索来源: 线索${String(s.totalLeads).padStart(4)} = 留资${String(s.totalPrivateMsgRetain||0).padStart(4)} + 表单${String(s.totalFormSubmit||0).padStart(4)} ≈ 转化${String(s.totalConversions).padStart(4)} ║`);
  const orrPct = s.openRetainRate ? (s.openRetainRate*100).toFixed(1)+'%' : 'N/A';
  console.log(`║  开口留资率: ${orrPct.padStart(8)} (开${String(s.totalPrivateMsgOpen||0).padStart(3)}→留${String(s.totalPrivateMsgRetain||0).padStart(3)})       ║`);
  console.log(`║  消耗速度: ¥${(d.speedCurrent||0).toFixed(1).padStart(8)}/min               ║`);
  console.log(`║  预算使用: ${((d.budgetUsed||0)*100).toFixed(0).padStart(5)}%  (¥${(d.dailyBudget||45000).toFixed(0).padStart(7)})     ║`);
  if (s.accountBudget > 0) {
    const abPct = ((s.accountSpend||0) / s.accountBudget * 100).toFixed(0);
    console.log(`║  账户预算: ¥${(s.accountSpend||0).toFixed(0).padStart(10)} / ¥${s.accountBudget.toFixed(0).padStart(8)} (${abPct}%) ║`);
  }
  console.log(`║  节奏健康: ${(d.pacingHealth||'N/A').padStart(6)}  时段: ${(d.timeSlot||'N/A').padStart(8)}     ║`);
  console.log(`║  告警数:  ${String(analysis.alerts.length).padStart(6)}                   ║`);
  const lc = d.lifecycle || {};
  const lcStr = `🌱${lc.cold_start||0} 🔥${lc.active||0} 📉${lc.declining||0} 💀${lc.dead||0}`;
  console.log(`║  生命周期: ${lcStr.padEnd(30)}║`);
  console.log('╚══════════════════════════════════════╝');
  
  if (analysis.alerts.length > 0) {
    console.log('\n⚠️ 告警:');
    analysis.alerts.filter(a => a.severity === 'high').forEach(a =>
      console.log(`  🔴 ${a.name}: ${a.detail}`));
    analysis.alerts.filter(a => a.severity === 'medium').forEach(a =>
      console.log(`  🟡 ${a.name}: ${a.detail}`));
  }
  
  // 守护反馈服务器 (确保推送回调可用)
  await guardFeedbackServer();

  // 飞书推送
  await sendFeishuPush(analysis);
  
  console.log(`\n📄 报表: ${htmlFile}`);
  console.log(`⏱ 耗时: ${elapsed}s`);
  console.log(`[${new Date().toLocaleTimeString()}] ✅ 完成`);
}

main().catch(e => {
  const msg = e.message || String(e);
  const stack = e.stack || '';
  // 提取关键行号信息（前3行堆栈）
  const stackLines = stack.split('\n').slice(0, 4).map(l => l.trim()).join(' | ');
  console.error('❌ 错误:', msg);
  console.error('📍 堆栈:', stackLines);
  try { recordDataGap(`监控脚本异常: ${msg.slice(0, 200)}`); } catch {}
  process.exit(1);
});
