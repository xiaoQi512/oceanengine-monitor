// oceanengine-monitor-v3.mjs — 巨量引擎监控 v4
// v4: HTTP API主方案 + CDP降级（速度提升30-60倍）
// 使用逆向工程验证的3个内部API端点

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';
import Database from 'better-sqlite3';
import {
  getLocalDate, findLarkCli, checkFeedbackServer, guardFeedbackServer,
  getCurrentAnchorName,
  loadSuggestionHistory, saveSuggestionHistory, recalcSummary,
  atomicWriteJSON, minutesBetween,
  DATA_DIR, REPORT_DIR, HISTORY_FILE, FEEDBACK_PORT, FEISHU_CHAT_ID,
  ACCOUNT_NAME, ACCOUNT_ID, CAMPAIGN_URL, DAILY_BUDGET, DAILY_START_HOUR, DAILY_END_HOUR, getTodayShiftWindow, getLiveWindowLabel,
  CHROME_USER_DATA_DIR, CHROME_PROFILE_DIRECTORY, findChromeExe,
} from './monitor-utils.mjs';
import { ensureDataConsistency } from './data-consistency-check.mjs';
import { quickConnectWithRetry, checkCDP } from './cdp-client.mjs';
import { waitForToolbar, waitForTableRows, waitForPageReady } from './wait-utils.mjs';
import { calibratePage } from './calibrate-page.mjs';
import { createClient as createApiClient, collectAllData, getOnlineRoomList, getLiveRoomStatus } from './oceanengine-api-client.mjs';
import { pushCard, pushFile } from './feishu-push-guard.mjs';
import { insertSnapshot, verifyConsistency, closeDb as closeWriterDb } from './db/writer.mjs';
import { refreshMaterialized } from './db/refresh-materialized.mjs';

// 日志聚合由 monitor-utils.mjs -> logger.mjs 统一处理（console 劫持 + 按日轮转）
const PM2_PREFIX = process.env.OEC_PM2_TEST === '1' ? '🧪 [PM2测试] ' : '';

// 动态读取排班窗口,覆盖默认值
const _shiftWin = getTodayShiftWindow();
const CONFIG = {
  accountName: ACCOUNT_NAME,
  accountId: ACCOUNT_ID,
  campaignUrl: CAMPAIGN_URL,
  dataDir: DATA_DIR,
  reportDir: REPORT_DIR,
  pageSize: 100,
  // ====== 投放窗口 ======
  dailyStartHour: _shiftWin.startHour,
  dailyStartMinute: _shiftWin.startMinute || 0,
  dailyEndHour: _shiftWin.endHour,
  dailyEndMinute: _shiftWin.endMinute || 0,
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
  // ====== 详实 HTML 报表开关 ======
  enableHtmlReport: false,   // 15分钟报告：false 关闭 HTML 生成与飞书文件发送
};

// ====== 辅助函数 ======
// getLocalDate, findLarkCli, checkFeedbackServer, guardFeedbackServer 等已移入 monitor-utils.mjs

function escHtml(str) { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

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
  const chromeExe = findChromeExe();
  if (!chromeExe) {
    console.log('  ⚠ 未找到 Chrome 安装路径，无法自动拉起');
    return false;
  }
  try {
    const userDataDir = CHROME_USER_DATA_DIR;
    const args = [
      `--remote-debugging-port=9222`,
      `--user-data-dir=${userDataDir}`,
      `--profile-directory=${CHROME_PROFILE_DIRECTORY}`,
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
  const whPath = path.join(__dirname, '.feishu-webhook');
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

// ====== CDP 连接 (统一模块 cdp-client.mjs) ======
// connect / getTab / closePopups / waitForTableReady 已由 cdp-client + wait-utils 替代
// v3.1 使用 quickConnectWithRetry 获得重连+心跳能力

// 关闭弹窗（使用client.evalJs）
async function closePopups(client) {
  try {
    await client.evalJs(`
      (() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        const popupKeywords = ['立即体验', '我知道了', '知道了', '升级'];
        let closed = [];
        for (const btn of btns) {
          const t = btn.textContent?.trim();
          if (popupKeywords.includes(t) && btn.offsetParent) {
            btn.click();
            closed.push(t);
          }
        }
        return closed;
      })()
    `);
  } catch {}
}

// 等待表格就绪（使用 wait-utils）
async function waitForTableReady(client, timeoutMs = 60000) {
  return waitForTableRows(client, 1, {
    timeout: timeoutMs,
    pollInterval: 1000,
    skipSummary: true,
  });
}

// v3.1 统一使用 quickConnectWithRetry 连接
// 原 connect/getTab 内联代码已移除

// ====== 设置每页显示条数 ======
// 使用 CDP Input.dispatchMouseEvent 模拟真实鼠标点击
// JS合成事件(dispatchEvent)在OVUI Vue组件中经常不生效，真实鼠标事件走Chrome完整输入管道
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
  
  // 2. 获取 select 元素中心坐标（viewport坐标系）
  const rBox = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const sel = document.querySelector('.ovui-page-select .ovui-select');
      if (!sel) return JSON.stringify({ found: false });
      const rect = sel.getBoundingClientRect();
      return JSON.stringify({ found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: rect.width, h: rect.height });
    })()`,
    returnByValue: true
  });
  const box = JSON.parse(rBox?.result?.result?.value || '{"found":false}');
  if (!box.found) {
    console.log('  ⚠ 未找到分页select元素');
    return false;
  }
  console.log(`  select中心: (${Math.round(box.x)}, ${Math.round(box.y)})`);
  
  // 3. 用 CDP 真实鼠标事件打开下拉框
  // mouseMoved → mousePressed → mouseReleased 模拟完整点击序列
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await sleep(100);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(50);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(1500);
  
  // 4. 检查下拉是否打开
  const r1 = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const popper = document.querySelector('.ovui-select__popper--show');
      if (!popper) return JSON.stringify({ open: false });
      const opts = popper.querySelectorAll('.ovui-option');
      const texts = Array.from(opts).map(o => o.textContent?.trim());
      return JSON.stringify({ open: true, options: texts });
    })()`,
    returnByValue: true
  });
  const dropdown = JSON.parse(r1?.result?.result?.value || '{"open":false}');
  
  if (!dropdown.open) {
    console.log('  下拉未打开，用CDP重试点击...');
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await sleep(100);
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(50);
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(2000);
    
    // 再次检查
    const r1b = await client.send('Runtime.evaluate', {
      expression: `(()=>{
        const popper = document.querySelector('.ovui-select__popper--show');
        if (!popper) return JSON.stringify({ open: false });
        const opts = popper.querySelectorAll('.ovui-option');
        const texts = Array.from(opts).map(o => o.textContent?.trim());
        return JSON.stringify({ open: true, options: texts });
      })()`,
      returnByValue: true
    });
    const dd2 = JSON.parse(r1b?.result?.result?.value || '{"open":false}');
    if (!dd2.open) {
      console.log('  ❌ 下拉框仍无法打开');
      return false;
    }
    Object.assign(dropdown, dd2);
  }
  console.log(`  下拉已打开: ${dropdown.options?.join('/')}`);
  
  // 5. 获取目标选项的坐标，用 CDP 真实鼠标点击
  const targetText = `${size}条/页`;
  const rOpt = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const popper = document.querySelector('.ovui-select__popper--show');
      if (!popper) return JSON.stringify({ found: false });
      const opts = popper.querySelectorAll('.ovui-option');
      for (const opt of opts) {
        if (opt.textContent?.trim() === '${targetText}') {
          const rect = opt.getBoundingClientRect();
          return JSON.stringify({ found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: opt.textContent?.trim() });
        }
      }
      return JSON.stringify({ found: false, options: Array.from(opts).map(o => o.textContent?.trim()) });
    })()`,
    returnByValue: true
  });
  const optBox = JSON.parse(rOpt?.result?.result?.value || '{"found":false}');
  
  if (!optBox.found) {
    console.log(`  ❌ 未找到"${targetText}"选项，现有: ${optBox.options?.join('/')}`);
    // 关闭下拉：点击空白处
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 10, y: 10, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 10, y: 10, button: 'left', clickCount: 1 });
    return false;
  }
  console.log(`  目标选项中心: (${Math.round(optBox.x)}, ${Math.round(optBox.y)})`);
  
  // 6. CDP 真实鼠标点击目标选项
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: optBox.x, y: optBox.y });
  await sleep(100);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: optBox.x, y: optBox.y, button: 'left', clickCount: 1 });
  await sleep(50);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: optBox.x, y: optBox.y, button: 'left', clickCount: 1 });
  
  console.log(`  CDP点击完成: ${optBox.text}`);
  await sleep(2000);
  
  // 7. 验证
  const r3 = await client.send('Runtime.evaluate', {
    expression: `document.querySelector('.ovui-page-select input')?.value`,
    returnByValue: true
  });
  const newVal = r3?.result?.result?.value;
  console.log(`  当前每页: ${newVal}`);
  
  if (newVal === `${size}条/页`) {
    console.log(`  ✅ 页面大小已设置为${size}条/页`);
    return true;
  }
  
  // 验证失败：可能下拉没正确关闭或选项没生效，再等一会重查
  console.log(`  ⚠ 验证失败，当前值=${newVal}，等待重查...`);
  await sleep(3000);
  const r4 = await client.send('Runtime.evaluate', {
    expression: `document.querySelector('.ovui-page-select input')?.value`,
    returnByValue: true
  });
  const finalVal = r4?.result?.result?.value;
  console.log(`  最终每页: ${finalVal}`);
  return finalVal === `${size}条/页`;
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
  
  const clickResult = JSON.parse(r1?.result?.result?.value || '{"clicked":false}');
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
            leads: parseInt((data[8] || '0').replace(/,/g, '')) || 0,
            conversions: parseInt((data[9] || '0').replace(/,/g, '')) || 0,
            privateMsgOpen: parseInt((data[10] || '0').replace(/,/g, '')) || 0,
            privateMsgRetain: parseInt((data[11] || '0').replace(/,/g, '')) || 0,
            formSubmit: parseInt((data[12] || '0').replace(/,/g, '')) || 0,
            ctr: parseFloat((data[13] || '0%').replace('%', '')) / 100 || 0,
            cpm: parseFloat((data[14] || '0').replace(/,/g, '')) || 0,
            cvr: parseFloat((data[15] || '0%').replace('%', '')) / 100 || 0,
            liveViews: parseInt((data[16] || '0').replace(/,/g, '')) || 0,
            liveOver1Min: parseInt((data[17] || '0').replace(/,/g, '')) || 0,
            liveComments: parseInt((data[18] || '0').replace(/,/g, '')) || 0,
            componentCost: parseFloat((data[19] || '0').replace(/,/g, '')) || 0,
            dislike: parseInt((data[20] || '0').replace(/,/g, '')) || 0,
            report: parseInt((data[21] || '0').replace(/,/g, '')) || 0,
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
            // sumData 结构（来自实际探测, 2026-06-16 重新验证）:
            // [0]="" [1]="总计 185 项" [2-6]="" [7]=消耗 [8]=线索数 [9]=转化数 [10]=私信开口 [11]=私信留资 [12]=表单提交 [13]=CTR [14]=CPM [15]=CVR [16]=观看数 [17]=>1min [18]=评论数 ...
            // 注意: 汇总行结构与数据行完全一致，消耗在[7]
            const parseNum = (s) => parseFloat((s||'0').replace(/,/g,'')) || 0;
            const parseIntC = (s) => parseInt((s||'0').replace(/,/g,'')) || 0;  // strip commas before parseInt
            pageSummary = {
              spend:           parseNum(sumData[7]),        // [7]=消耗
              leads:           parseIntC(sumData[8]),        // [8]=线索数
              conversions:     parseIntC(sumData[9]),        // [9]=转化数
              privateMsgOpen:  parseIntC(sumData[10]),       // [10]=私信开口
              privateMsgRetain: parseIntC(sumData[11]),      // [11]=私信留资
              formSubmit:      parseIntC(sumData[12]),       // [12]=表单提交
              cpm:             parseNum(sumData[14]),        // [14]=CPM
              liveViews:       parseIntC(sumData[16]),       // [16]=直播间观看数
              liveOver1Min:    parseIntC(sumData[17]),       // [17]=直播间超过1分钟观看数
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
  if (typeof budgetStr === 'number') return budgetStr;
  const s = String(budgetStr);
  const m = s.match(/[\d,]+\.?\d*/);
  if (!m) return 0;
  return parseFloat(m[0].replace(/,/g, '')) || 0;
}

// ====== 数据分析 ======

// 加载历史快照（T-15min, T-30min, T-60min）
// 改为按真实时间戳找最接近目标年龄的快照，不再依赖固定 15 分钟索引
function loadPreviousSnapshots() {
  const result = { t15: null, t30: null, t60: null };
  try {
    const files = fs.readdirSync(CONFIG.dataDir)
      .filter(f => f.endsWith('.json') && f.startsWith('202'))
      .map(f => ({ name: f, age: Math.max((Date.now() - parseSnapshotTime(f)) / 60000, 0) }))
      .sort((a, b) => a.age - b.age); // 按年龄升序（最新的在前）

    if (files.length < 1) return result;

    // 查找最接近目标年龄的快照（优先在目标±容差内，否则取最近一个）
    const findClosest = (target) => {
      let best = null;
      for (const f of files) {
        if (f.age >= target - 5 && f.age <= target + 10) {
          if (!best || Math.abs(f.age - target) < Math.abs(best.age - target)) {
            best = f;
          }
        }
      }
      if (!best) {
        best = files.reduce((b, f) => Math.abs(f.age - target) < Math.abs(b.age - target) ? f : b, files[0]);
      }
      return best;
    };

    const t15f = findClosest(15);
    const t30f = findClosest(30);
    const t60f = findClosest(60);

    if (t15f) {
      result.t15 = readSnapshot(t15f.name);
      if (result.t15) result.t15._ageMinutes = Math.max(t15f.age, 1);
    }
    if (t30f) {
      result.t30 = readSnapshot(t30f.name);
      if (result.t30) result.t30._ageMinutes = Math.max(t30f.age, 1);
    }
    if (t60f) {
      result.t60 = readSnapshot(t60f.name);
      if (result.t60) result.t60._ageMinutes = Math.max(t60f.age, 1);
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
  
  // 取最近8个周期，x 轴用真实时间戳（分钟），不再假设每个点间隔 15 分钟
  const recent = log.slice(-8);
  const baseTime = recent.length > 0 ? new Date(recent[0].time).getTime() : 0;
  const cpaSeries = recent.map((e) => {
    const x = (new Date(e.time).getTime() - baseTime) / 60000;
    return { x, y: e.avgCPA || 0 };
  }).filter(p => p.y > 0);
  const spendSeries = recent.map((e) => {
    const x = (new Date(e.time).getTime() - baseTime) / 60000;
    return { x, y: e.speedCurrent || 0 };
  });

  const cpaSlope = computeLinearSlope(cpaSeries);
  const spendSlope = computeLinearSlope(spendSeries);

  // 计算相对于均值的日化变化率
  const avgCPA = cpaSeries.length > 0 ? cpaSeries.reduce((s, p) => s + p.y, 0) / cpaSeries.length : 0;
  const avgSpeed = spendSeries.length > 0 ? spendSeries.reduce((s, p) => s + p.y, 0) / spendSeries.length : 0;

  const spanMinutes = recent.length > 1 ? (new Date(recent[recent.length - 1].time).getTime() - baseTime) / 60000 : 0;
  const cpaChangeRate = avgCPA > 0 && spanMinutes > 0 ? (cpaSlope * spanMinutes) / avgCPA : 0;
  const spendChangeRate = avgSpeed > 0 && spanMinutes > 0 ? (spendSlope * spanMinutes) / avgSpeed : 0;

  return {
    cpaTrend: cpaSeries.length >= 3 ? { slope: cpaSlope, changeRate: cpaChangeRate, periods: cpaSeries.length, spanMinutes } : null,
    spendTrend: spendSeries.length >= 3 ? { slope: spendSlope, changeRate: spendChangeRate, periods: spendSeries.length, spanMinutes } : null,
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
      // 优先从原始计数重建 openRetainRate, 防止旧索引偏移导致存储值错误
      const bestOpen = best.totalPrivateMsgOpen || 0;
      const bestRetain = best.totalPrivateMsgRetain || 0;
      const bestRate = bestOpen > 0 ? bestRetain / bestOpen : (best.openRetainRate || 0);
      // 合理性校验: 存储的 rate 和原始计数的 rate 不一致时, 使用原始计数
      const storedRate = best.openRetainRate || 0;
      const computedRate = bestOpen > 0 ? bestRetain / bestOpen : 0;
      const effectiveRate = (bestOpen > 0 && Math.abs(storedRate - computedRate) > 0.05) ? computedRate : storedRate;
      hourlyEntries.push({
        date: dateStr,
        spend: best.accountSpend > 0 ? best.accountSpend : (best.totalSpend || 0),
        conversions: best.totalConversions || 0,
        cpa: best.avgCPA || 0,
        speed: best.speedCurrent || 0,
        activeCount: best.activeCount || 0,
        leads: best.totalLeads || 0,
        openRetainRate: effectiveRate,
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

  // 按真实时间中点切分前后两半，不再按条目数量对半
  const oldestTime = new Date(recent[0].time).getTime();
  const newestTime = new Date(recent[recent.length - 1].time).getTime();
  const midTime = (oldestTime + newestTime) / 2;
  const firstHalf = recent.filter(e => new Date(e.time).getTime() <= midTime);
  const secondHalf = recent.filter(e => new Date(e.time).getTime() > midTime);

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  // totalSpend / totalConversions / totalLeads 是日累计值，必须用(末-首)算增量，不能 sum
  const deltaSpend = arr => {
    if (arr.length < 2) return 0;
    return (arr[arr.length - 1].totalSpend || 0) - (arr[0].totalSpend || 0);
  };
  const deltaConv = arr => {
    if (arr.length < 2) return 0;
    return (arr[arr.length - 1].totalConversions || 0) - (arr[0].totalConversions || 0);
  };
  const deltaHours = arr => {
    if (arr.length < 2) return 0.25;
    return Math.max((new Date(arr[arr.length - 1].time).getTime() - new Date(arr[0].time).getTime()) / 3600000, 0.25);
  };

  const firstSpendDelta = deltaSpend(firstHalf);
  const secondSpendDelta = deltaSpend(secondHalf);
  const firstSpeedAvg = avg(firstHalf.map(e => e.speedCurrent || 0));
  const secondSpeedAvg = avg(secondHalf.map(e => e.speedCurrent || 0));
  const firstCPA = avg(firstHalf.map(e => e.avgCPA || 0).filter(v => v > 0));
  const secondCPA = avg(secondHalf.map(e => e.avgCPA || 0).filter(v => v > 0));

  // 计算变化幅度
  const speedChange = firstSpeedAvg > 0 ? (secondSpeedAvg - firstSpeedAvg) / firstSpeedAvg : 0;
  const cpaChange = firstCPA > 0 ? (secondCPA - firstCPA) / firstCPA : 0;

  // 3h 内转化率趋势 (使用增量而非累计总和)
  const firstConvDelta = deltaConv(firstHalf);
  const secondConvDelta = deltaConv(secondHalf);
  const firstConvRate = firstSpendDelta > 0 ? firstConvDelta / firstSpendDelta * 1000 : 0;
  const secondConvRate = secondSpendDelta > 0 ? secondConvDelta / secondSpendDelta * 1000 : 0;
  const convRateChange = firstConvRate > 0 ? (secondConvRate - firstConvRate) / firstConvRate : 0;

  // 消耗加速率（小时环比）—— 用增量/实际时段算真实燃烧速率
  const firstHours = deltaHours(firstHalf);
  const secondHours = deltaHours(secondHalf);
  const firstBurnRate = firstSpendDelta / firstHours;
  const burnRate = secondSpendDelta / secondHours;

  return {
    sampleCount: recent.length,
    windowHours: deltaHours(recent).toFixed(1),
    firstHours: firstHours.toFixed(1),
    secondHours: secondHours.toFixed(1),
    // 速度
    speed: { first: firstSpeedAvg, second: secondSpeedAvg, change: speedChange },
    // CPA
    cpa: { first: firstCPA || 0, second: secondCPA || 0, change: cpaChange },
    // 消耗量 (增量)
    spend: { first: firstSpendDelta, second: secondSpendDelta, change: firstSpendDelta > 0 ? (secondSpendDelta - firstSpendDelta) / firstSpendDelta : 0 },
    // 转化率 (每千元消耗)
    convRate: { first: firstConvRate, second: secondConvRate, change: convRateChange },
    // 燃烧速度
    burnRate: { first: firstBurnRate, second: burnRate, change: firstBurnRate > 0 ? (burnRate - firstBurnRate) / firstBurnRate : 0 },
    // 转化数 (增量)
    conversions: { first: firstConvDelta, second: secondConvDelta },
  };
}
// ====== 数据驱动生命周期判定（基于当天快照，无持久化状态） ======
// 判定规则:
//   活跃: 默认状态（无冷启动阶段）
//   疑似死亡: 首次出现≥3h 且 时均消耗<¥100
//   复活起量: 上一周期为死亡 → 当前时均≥¥100 → 标记 justRevived

// 加载当天全部快照（文件名升序，仅加载活跃计划列表用于判定首次出现时间）
function loadTodaysSnapshots() {
  const today = new Date().toISOString().substring(0, 10);
  try {
    const files = fs.readdirSync(CONFIG.dataDir)
      .filter(f => f.endsWith('.json') && f.startsWith(today))
      .sort(); // 升序: 最早的在前
    return files.map(f => {
      try {
        const snap = JSON.parse(fs.readFileSync(path.join(CONFIG.dataDir, f), 'utf-8'));
        snap._time = f.substring(0, 19).replace('T', ' ') + ':00';
        return snap;
      } catch { return { active: [], allSpending: [], time: null }; }
    });
  } catch { return []; }
}

function computeLifecycleFromSnapshots(active, todaySnapshots, prev15Snapshot) {
  const now = new Date();

  // 第一步: 从当天快照中找每个计划的最早出现时间
  const firstSeenMap = new Map(); // campaignId -> { firstTime: Date, firstSpend: number }
  const prevDeadIds = new Set();   // 上一周期标记为死亡的计划ID

  // 从上一周期快照获取死亡计划列表
  if (prev15Snapshot) {
    const prevActive = prev15Snapshot.active || prev15Snapshot.allSpending || [];
    for (const pc of prevActive) {
      if (pc._lifecycle === 'dead') prevDeadIds.add(pc.id);
    }
  }

  // 只取最近6小时内的快照推断首次出现（避免全天历史导致 hoursActive 虚高）
  for (const snap of todaySnapshots) {
    const campaigns = snap.active || snap.allSpending || [];
    if (campaigns.length === 0) continue; // 跳过空快照

    const snapTime = new Date(snap.time || snap._time || 0);
    if (snapTime.getTime() < Date.now() - 6 * 3600_000) continue; // 跳过6小时前的快照
    for (const c of campaigns) {
      if (!c.id || c.id === 'unknown') continue;
      if (!firstSeenMap.has(c.id)) {
        firstSeenMap.set(c.id, { firstTime: snapTime.getTime(), firstSpend: c.spend || 0 });
      }
    }
  }

  // 第二步: 判定每个活跃计划
  const lifecycleSummary = { cold_start: 0, active: 0, declining: 0, dead: 0 };
  for (const c of active) {
    const fs = firstSeenMap.get(c.id);
    if (!fs) {
      // 无历史记录（首次出现且当前快照是最早的），标记为活跃
      c._lifecycle = 'active';
      c._justRevived = false;
      lifecycleSummary.active++;
      continue;
    }

    const msActive = Date.now() - fs.firstTime;
    const hoursActive = msActive / 3600000; // 真实经过小时，保留分钟精度
    const hourlySpend = hoursActive > 0 ? c.spend / hoursActive : 0;

    const wasDead = prevDeadIds.has(c.id);

    if (hoursActive >= 3 && hourlySpend < 100) {
      // 疑似死亡
      c._lifecycle = 'dead';
      c._justRevived = false;
      lifecycleSummary.dead++;
    } else if (wasDead && hourlySpend >= 100) {
      // 复活 → 活跃，并标记起量
      c._lifecycle = 'active';
      c._justRevived = true;
      lifecycleSummary.active++;
    } else {
      c._lifecycle = 'active';
      c._justRevived = false;
      lifecycleSummary.active++;
    }
  }

  return lifecycleSummary;
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
  // 账户数据有效时直接用账户消耗（含=0的情况：当日刚开始/已重置）
  // 账户消耗=0 且 有效（accountBudget>0）是今天真实消耗为0，不应fallback到计划累加（可能是昨天数据）
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
    delta: { age15: 0, age60: 0, spendLast15min: 0, spendLastHour: 0, speedCurrent: 0, speedHour: 0,
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
  // 自纠错: 线索数 = 留资+表单, 若逐行累加的leads < privateMsgRetain（索引偏移），
  // 则用 (privateMsgRetain + formSubmit) 修正，确保显示值一致
  if (totalLeads < totalPrivateMsgRetain) {
    console.log(`  ⚠️ totalLeads(${totalLeads}) < privateMsgRetain(${totalPrivateMsgRetain}), 使用留资+表单修正`);
    totalLeads = totalPrivateMsgRetain + totalFormSubmit;
  }
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
    // 合理性校验: 留资不应大于开口, 表单不应大于留资, 消耗应为货币值(>100)
    const psValid = pageSummary.privateMsgRetain <= pageSummary.privateMsgOpen
      && pageSummary.formSubmit <= pageSummary.privateMsgRetain + 5  // 容差5
      && (pageSummary.spend === 0 || pageSummary.spend > 100);  // 消耗=0可能仅是提取失败, >100才是正常货币值
    if (!psValid) {
      console.log(`  ⚠️ 页面汇总校验失败(索引可能偏移), 跳过校准: spend=${pageSummary.spend} open=${pageSummary.privateMsgOpen} retain=${pageSummary.privateMsgRetain} form=${pageSummary.formSubmit}`);
    }
    if (psValid && pageSummary.spend > 0) {
      totalSpend = pageSummary.spend;
      console.log(`  ✅ 页面汇总校准 totalSpend: ¥${totalSpend.toFixed(0)}`);
    }
    if (psValid && pageSummary.conversions > 0) {
      totalConversions = pageSummary.conversions;
      totalLeads = pageSummary.leads;
      totalPrivateMsgOpen = pageSummary.privateMsgOpen;
      totalPrivateMsgRetain = pageSummary.privateMsgRetain;
      totalFormSubmit = pageSummary.formSubmit;
      openRetainRate = totalPrivateMsgOpen > 0 ? totalPrivateMsgRetain / totalPrivateMsgOpen : 0;
      console.log(`  ✅ 页面汇总校准: 转化${totalConversions} 线索${totalLeads} 开口${totalPrivateMsgOpen} 留资${totalPrivateMsgRetain} 表单${totalFormSubmit}`);
    }
    // 汇总行 CPM / 停留率 (使用页面总计行的加权均值, 而非逐计划算数平均)
    if (psValid && pageSummary.cpm > 0) {
      avgCPM = pageSummary.cpm;
    }
    if (psValid && pageSummary.liveViews > 0) {
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

  // ====== 检测计划状态变化：投放中 -> 项目超出预算 ======
  // 对比本次快照与上一次15分钟快照，找出状态由「投放中」变为「项目超出预算」的计划
  const budgetExceededChanges = [];
  if (prev.t15) {
    for (const c of allSpending) {
      const prevC = prevIndex15.get(c.id);
      if (!prevC) continue;
      const wasActive = prevC.status === '投放中';
      const nowExceeded = typeof c.status === 'string' && c.status.includes('超出预算');
      if (wasActive && nowExceeded) {
        budgetExceededChanges.push({
          id: c.id,
          name: c.name,
          spend: c.spend || 0,
          budget: c.budget || 0,
          prevStatus: prevC.status,
          curStatus: c.status,
        });
      }
    }
    if (budgetExceededChanges.length > 0) {
      console.log(`  ⚠️ 检测到 ${budgetExceededChanges.length} 条计划从「投放中」变为「项目超出预算」: ${budgetExceededChanges.map(c => c.name.slice(0, 20)).join(', ')}`);
    }
  }

  // 历史总消耗/CPA 对比基线
  // 规则: 当前用账户消耗时, 历史也必须用账户消耗(同源比较); 若历史快照accountSpend=0说明跨天/重置, 视为无效基线(null)
  // 若当前不用账户消耗(无账户数据), 才回退到totalSpend
  const prevTotal15 = useAccountSpend
    ? (prev.t15?.summary?.accountSpend > 0 ? prev.t15.summary.accountSpend : null)
    : (prev.t15?.summary?.totalSpend || null);
  const prevTotal30 = useAccountSpend
    ? (prev.t30?.summary?.accountSpend > 0 ? prev.t30.summary.accountSpend : null)
    : (prev.t30?.summary?.totalSpend || prevTotal15);
  const prevTotal60 = useAccountSpend
    ? (prev.t60?.summary?.accountSpend > 0 ? prev.t60.summary.accountSpend : null)
    : (prev.t60?.summary?.totalSpend || prevTotal30);
  const prevCPA15 = prev.t15?.summary?.avgCPA || avgCPA;
  const prevCPA30 = prev.t30?.summary?.avgCPA || prevCPA15;

  // 消耗速度 (元/分钟) — 用真实快照年龄作除数
  const age15 = prev.t15?._ageMinutes || 15;
  const age60 = prev.t60?._ageMinutes || 60;
  let spendLast15min = prevTotal15 !== null ? totalSpend - prevTotal15 : 0;
  // 保护: 增量为负说明历史基线来自跨天/重置，视为无基线(增量=0)
  if (spendLast15min < 0) {
    console.log(`  ⚠️ spendLast15min 为负(${spendLast15min.toFixed(0)}), 可能跨天重置，清零增量`);
    spendLast15min = 0;
  }
  const speedCurrent = spendLast15min / Math.max(age15, 1);
  let spendLastHour = prevTotal15 !== null && prevTotal60 !== null ? (totalSpend - prevTotal60) : spendLast15min;
  if (spendLastHour < 0) spendLastHour = 0; // 同上
  const speedHour = spendLastHour / Math.max(age60, 1);

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
    else if (c._justRevived) trend = '起量';                // 复活计划强制标记起量
    else if (changeRate > 0.3 && spendDelta > 5) trend = '起量';
    else if (changeRate < -0.15 && spendDelta < -10 && prevC && prevC.spend > 10) trend = '掉量';  // 拓展: 15%降幅即识别
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
  const { dailyStartHour, dailyStartMinute, dailyEndHour, dailyEndMinute } = CONFIG;
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const startH = dailyStartHour + (dailyStartMinute || 0) / 60;
  const endH = dailyEndHour + (dailyEndMinute || 0) / 60;
  const windowDuration = endH - startH;
  const elapsedHours = Math.max(0, Math.min(currentHour - startH, windowDuration));
  const timeProgress = Math.min(elapsedHours / windowDuration, 1); // 0-1
  const idealSpend = timeProgress * effectiveBudget;
  const pacingRatio = idealSpend > 0 ? totalSpend / idealSpend : 0;
  
  // 预估今日总消耗（按当前均速推算）
  const minutesElapsed = Math.max(elapsedHours * 60, 1);
  const avgSpeed = totalSpend / minutesElapsed; // 今日平均元/分钟
  const remainingMinutes = Math.max((endH - Math.min(currentHour, endH)) * 60, 0);
  const projectedDaily = totalSpend + avgSpeed * remainingMinutes;
  
  let pacingHealth;
  if (pacingRatio >= 0.8 && pacingRatio <= 1.2) pacingHealth = 'good';
  else if (pacingRatio >= 0.6 && pacingRatio <= 1.5) pacingHealth = 'warning';
  else pacingHealth = 'danger';
  
  // 当前时段标签（由排班表动态计算）
  let timeSlot;
  if (currentHour < startH) timeSlot = '未开始';
  else if (currentHour < 9) timeSlot = '冷启动期';
  else if (currentHour < 11) timeSlot = '早高峰';
  else if (currentHour < 14) timeSlot = '午高峰';
  else if (currentHour < 17) timeSlot = '午后平稳期';
  else if (currentHour < 20) timeSlot = '晚高峰';
  else if (currentHour < endH) timeSlot = '夜间收尾';
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
        detail: `近${window3h.secondHours}h均速 ¥${window3h.speed.second.toFixed(0)}/min，较前${window3h.firstHours}h ¥${window3h.speed.first.toFixed(0)}/min 涨 ${excess}%`,
        severity: window3h.speed.change > 1.0 ? 'high' : 'medium',
      });
    } else if (window3h.speed.change < -0.5 && window3h.spend.first > 200) {
      const drop = (Math.abs(window3h.speed.change) * 100).toFixed(0);
      alerts.push({
        type: 'speed_3h',
        name: '3h消耗速度骤降',
        detail: `近${window3h.secondHours}h均速 ¥${window3h.speed.second.toFixed(0)}/min，较前${window3h.firstHours}h ¥${window3h.speed.first.toFixed(0)}/min 跌 ${drop}%`,
        severity: 'medium',
      });
    }

    // A2. 3h CPL 异常波动
    if (window3h.cpa.first > 0 && window3h.cpa.second > 0 && window3h.cpa.change > 0.25) {
      const rise = (window3h.cpa.change * 100).toFixed(0);
      alerts.push({
        type: 'cpa_3h',
        name: '3h成本持续攀升',
        detail: `近${window3h.secondHours}h CPL ¥${window3h.cpa.second.toFixed(0)}，较前${window3h.firstHours}h ¥${window3h.cpa.first.toFixed(0)} 涨 ${rise}%`,
        severity: window3h.cpa.change > 0.5 ? 'high' : 'medium',
      });
    }

    // A3. 3h 转化率坍塌
    if (window3h.convRate.change < -0.3 && window3h.convRate.second > 0) {
      const drop = (Math.abs(window3h.convRate.change) * 100).toFixed(0);
      alerts.push({
        type: 'conv_drop_3h',
        name: '3h转化效率下降',
        detail: `近${window3h.secondHours}h 每千元转化 ${window3h.convRate.second.toFixed(1)}，较前${window3h.firstHours}h ${window3h.convRate.first.toFixed(1)} 跌 ${drop}%`,
        severity: window3h.convRate.change < -0.5 ? 'high' : 'medium',
      });
    }

    // A4. 3h 燃烧加速率异常
    if (window3h.burnRate.change > 0.6 && window3h.burnRate.second > 500) {
      const accel = (window3h.burnRate.change * 100).toFixed(0);
      alerts.push({
        type: 'burn_accel_3h',
        name: '消耗加速度异常',
        detail: `近${window3h.secondHours}h燃烧速率 ¥${window3h.burnRate.second.toFixed(0)}/h，较前${window3h.firstHours}h ¥${window3h.burnRate.first.toFixed(0)}/h 加速 ${accel}%`,
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
      // 小样本保护: 3天仅3个数据点, sigma估计不稳定, 放宽阈值到-2.5σ
      const rrThreshold = multiDay.sampleDays >= 5 ? -2.0 : -2.5;
      if (rrSigma < rrThreshold) {
        alerts.push({
          type: 'retain_rate_drop',
          name: `开口留资率异常偏低 (${rrSigma.toFixed(1)}σ)`,
          detail: `当前开留率 ${(openRetainRate*100).toFixed(1)}%（留${totalPrivateMsgRetain}/开${totalPrivateMsgOpen}），近${multiDay.sampleDays}天同时段均值 ${(multiDay.openRetainRate.mean*100).toFixed(1)}%，显著低于历史水平`,
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
    const rrBad = multiDayRef.openRetainRate && openRetainRate > 0 && multiDayRef.openRetainRate.stdev > 0.02 && (openRetainRate - multiDayRef.openRetainRate.mean) / multiDayRef.openRetainRate.stdev < (multiDayRef.sampleDays >= 5 ? -1.5 : -2.0);
    const cpaBad = multiDayRef.cpa && avgCPA > 0 && multiDayRef.cpa.mean > 0 && avgCPA > multiDayRef.cpa.mean * 1.25;
    const cpmBad = multiDayRef.cpm && avgCPM > 0 && multiDayRef.cpm.mean > 0 && avgCPM > multiDayRef.cpm.mean * 1.3;
    const vrBad = multiDayRef.viewRetention && viewRetention > 0 && multiDayRef.viewRetention.stdev > 0.02 && (viewRetention - multiDayRef.viewRetention.mean) / multiDayRef.viewRetention.stdev < -1.5;
    const effBad = multiDayRef.convEfficiency && convEfficiency > 0 && multiDayRef.convEfficiency.mean > 0 && convEfficiency < multiDayRef.convEfficiency.mean * 0.6;

    if (cpaBad) compoundRisks.push('CPL↑');
    if (cpmBad) compoundRisks.push('CPM↑');
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
  if (speedHour > 0 && speedCurrent > speedHour * 2 && speedCurrent > 7) {
    alerts.push({
      type: 'speed_spike',
      name: `${Math.round(age15)}m突发消耗加速`,
      detail: `近${Math.round(age15)}m速度 ¥${speedCurrent.toFixed(0)}/min，为${Math.round(age60)}h均速的 ${((speedCurrent/speedHour)*100).toFixed(0)}%`,
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
        planName: c.name, // 存全名，供 action-queue 使用
        name: `零转化消耗: ${c.name.slice(0, 35)}`,
        detail: `消耗 ¥${c.spend.toFixed(0)} 但零转化，是否需要暂停？`,
        severity: c.spend > 200 ? 'high' : 'medium',
        campaignId: c.id,
        needAction: true,  // 标记：需要询问用户是否执行操作
      });
    }
    if (c.cpa > avgCPA * 2.5 && c.spend > 30 && c.conversions > 0) {
      alerts.push({
        type: 'high_cpa',
        planName: c.name,
        name: `高成本计划: ${c.name.slice(0, 35)}`,
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
          planName: c.name,
          name: `已撞线暂停: ${c.name.slice(0, 30)}`,
          detail: `消耗 ¥${c.spend.toFixed(0)} 已达计划预算 ¥${planBudget.toFixed(0)} (${exceedPct.toFixed(0)}%)，已暂停投放，建议追加预算并手动恢复`,
          severity: 'high',
          campaignId: c.id,
        });
      } else {
        // 阶梯1: 超过80%，预算即将耗尽
        alerts.push({
          type: 'budget_cap',
          name: `预算即将耗尽: ${c.name.slice(0, 30)}`,
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

  // 5. 账户余额不足预警（独立于日预算监控，按预估日耗计算可支撑天数）
  if (hasAccountData && accountBalance > 0) {
    const effectiveDailyBurn = projectedDaily > 0 ? projectedDaily : (effectiveBudget);
    const daysRemaining = effectiveDailyBurn > 0 ? accountBalance / effectiveDailyBurn : 999;
    const dailyLabel = projectedDaily > 0 ? `日耗约 ¥${projectedDaily.toFixed(0)}` : `日预算 ¥${effectiveBudget.toFixed(0)}`;
    
    if (daysRemaining < 1) {
      alerts.push({
        type: 'balance_low',
        name: '账户余额严重不足',
        detail: `余额 ¥${accountBalance.toFixed(0)} 不足支撑1天 (${dailyLabel})，预计今日/明日耗尽，请立即充值！`,
        severity: 'high',
        daysRemaining,
        projectedDaily: effectiveDailyBurn,
      });
    } else if (daysRemaining < 2) {
      alerts.push({
        type: 'balance_low',
        name: '账户余额不足',
        detail: `余额 ¥${accountBalance.toFixed(0)} 仅支撑约 ${daysRemaining.toFixed(1)} 天 (${dailyLabel})，建议尽快充值`,
        severity: 'medium',
        daysRemaining,
        projectedDaily: effectiveDailyBurn,
      });
    } else if (daysRemaining < 3) {
      alerts.push({
        type: 'balance_low',
        name: '账户余额偏低',
        detail: `余额 ¥${accountBalance.toFixed(0)} 可支撑约 ${daysRemaining.toFixed(1)} 天 (${dailyLabel})，可提前安排充值`,
        severity: 'low',
        daysRemaining,
        projectedDaily: effectiveDailyBurn,
      });
    }
  }

  console.log('  [DEBUG] CK10: funnel-updated, alertCount=' + alerts.length + ' totalLeads=' + totalLeads);

  // 6. 掉量计划汇总告警
  if (dropping.length >= 3) {
    alerts.push({
      type: 'dropping',
      name: `${dropping.length} 条计划在掉量`,
      detail: dropping.map(c => `${c.name.slice(0, 30)}: 近${Math.round(age15||15)}分钟消耗 ¥${c.spendDelta.toFixed(1)} (变化 ${(c.changeRate*100).toFixed(0)}%)`).join('\n'),
      severity: dropping.length >= 5 ? 'medium' : 'low',
    });
  }
  
  // ====== 滑动窗口趋势检测 ======
  const trends = detectTrends();
  if (trends.cpaTrend && trends.cpaTrend.changeRate > 0.08) {
    alerts.push({
      type: 'cpa_trend',
      name: 'CPL 持续走高趋势',
      detail: `近${trends.cpaTrend.spanMinutes.toFixed(0)}分钟CPL以每分钟 ¥${trends.cpaTrend.slope.toFixed(2)} 的速度上升，累计预估走高 ${(trends.cpaTrend.changeRate*100).toFixed(0)}%`,
      severity: trends.cpaTrend.changeRate > 0.15 ? 'high' : 'medium',
    });
  }
  if (trends.spendTrend && trends.spendTrend.changeRate > 0.15) {
    alerts.push({
      type: 'spend_trend',
      name: '消耗持续加速趋势',
      detail: `近${trends.spendTrend.spanMinutes.toFixed(0)}分钟消耗速度以每分钟 ¥${trends.spendTrend.slope.toFixed(2)} 递增，累计预估走高 ${(trends.spendTrend.changeRate*100).toFixed(0)}%，需关注预算`,
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

  // ====== 数据驱动生命周期判定 ======
  const todaySnapshots = loadTodaysSnapshots();
  const lifecycleSummary = computeLifecycleFromSnapshots(active, todaySnapshots, prev.t15);
  
  // 疑似死亡告警
  const deadCampaigns = active.filter(c => c._lifecycle === 'dead');
  if (deadCampaigns.length > 0) {
    alerts.push({
      type: 'dead_plan',
      name: `${deadCampaigns.length} 条计划疑似死亡`,
      detail: deadCampaigns.map(c => `${c.name.slice(0, 30)}: 时均消耗<¥100 且 已投放≥3h`).join('; '),
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
    budgetExceededChanges,
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
      age15,
      age60,
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
  const liveWin = getLiveWindowLabel();
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
      <td><span class="badge bg-${a.severity==='high'?'red':a.severity==='medium'?'yellow':'green'}">${typeLabel}</span> ${escHtml(a.name)}${suppressed ? ' <span style="font-size:10px;color:#999">(历史已抑制)</span>' : ''}</td>
      <td colspan="4">${escHtml(a.detail).replace(/\n/g, '<br>')}</td>
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
    const lcEmoji = { cold_start: '🔥', active: '🔥', declining: '📉', dead: '💀' }[lcStage] || '🔥';
    // 标准化状态显示
    let statusDisplay = c.status || '';
    if (statusDisplay.includes('启用中') || statusDisplay.includes('投放中')) statusDisplay = '投放中';
    else if (statusDisplay.includes('超出预算')) statusDisplay = '未投放(超出预算)';
    else if (statusDisplay.includes('暂停')) statusDisplay = '未投放(已暂停)';
    const statusColor = statusDisplay === '投放中' ? '#10b981' : '#94a3b8';
    return `
    <tr>
      <td style="max-width:160px" title="${escHtml(c.name)}">${escHtml(c.name.slice(0, 28))}<br><span style="color:#888;font-size:10px">ID:${(c.id||'').slice(-10)}</span></td>
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
      <td style="max-width:170px">${escHtml(c.name)}<br><span style="color:#888;font-size:11px">ID:${(c.id||'').slice(-8)}</span></td>
      <td>${c.trend} ${trendTag}</td>
      <td style="font-weight:bold">¥${c.spend.toFixed(2)}</td>
      <td style="color:${c.spendDelta>=0?'#e74c3c':'#27ae60'}">¥${(c.spendDelta||0).toFixed(2)}</td>
      <td style="color:${c.changeRate>=0?'#e74c3c':'#27ae60'}">${(c.changeRate>=0?'+':'')}${((c.changeRate||0)*100).toFixed(0)}%</td>
      <td>${c.conversions||0}</td>
      <td style="font-weight:bold;color:${c.cpa > summary.avgCPA * 1.3 ? '#e74c3c' : '#27ae60'}">¥${(c.cpa||0).toFixed(2)}${c.cpa15 > 0 ? `<br><span style="font-size:0.85em;color:#888">${Math.round(delta.age15||15)}m: ¥${c.cpa15.toFixed(2)}</span>` : ''}</td>
      <td style="${capStyle}">${planBudget > 0 ? capPct.toFixed(0)+'%' : 'N/A'}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>极狐-区域福利号-直播 投放监控(离线快照) ${today}</title>
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
  <div class="sub">更新时间: ${now} | 时段: ${d.timeSlot || 'N/A'} | ${liveWin.labelCompact} | 有消耗 ${summary.totalSpending||0}条 · 投放中 ${summary.totalActive||0}条 · 起量 ${(rampingUp||[]).length} · 掉量 ${(dropping||[]).length} · 节奏 ${d.pacingHealth||'N/A'} | 活跃${d.lifecycle?.active||0}·死亡${d.lifecycle?.dead||0} | 离线快照</div>
</div>

<div class="cards">
  <div class="card"><div class="label">有消耗计划</div><div class="value blue pulse">${summary.totalSpending||0}</div><div class="subv">投放中 ${summary.totalActive||0} · 暂停 ${summary.totalSpending - summary.totalActive}</div></div>
  <div class="card"><div class="label">今日消耗${summary.useAccountSpend ? '<span style="font-size:10px;color:#10b981">●账户</span>' : ''}</div><div class="value red">¥${summary.totalSpend.toFixed(0)}</div><div class="subv">理想 ¥${(d.idealSpend||0).toFixed(0)} | ${Math.round(d.age15||15)}m +¥${(d.spendLast15min||0).toFixed(0)}</div></div>
  <div class="card"><div class="label">总转化 / CPL</div><div class="value green">${summary.totalConversions}</div><div class="subv">CPL ¥${summary.avgCPA.toFixed(0)}</div></div>
  <div class="card"><div class="label">近${Math.round(d.age15||15)}m CPL</div><div class="value ${d.cplLast15min > 0 ? (d.cplLast15min > summary.avgCPA * 1.3 ? 'red' : 'green') : 'blue'}">${d.convLast15min === -1 ? '—' : d.cplLast15min > 0 ? '¥' + d.cplLast15min.toFixed(0) : '—'}</div><div class="subv">${d.convLast15min === -1 ? '数据不足' : d.convLast15min > 0 ? d.convLast15min + '条转化' : '无新增转化'}</div></div>
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
    <h3 style="font-size:14px;margin-bottom:8px">📊 计划状态分布</h3>
    <p style="font-size:13px">
      ${d.lifecycle.active > 0 ? `<span style="color:#3b82f6">🔥 活跃 ${d.lifecycle.active}</span> · ` : ''}
      ${d.lifecycle.dead > 0 ? `<span style="color:#e74c3c">💀 疑似死亡 ${d.lifecycle.dead}</span>` : ''}
    </p>
  </div>` : ''}
</div>

<!-- 近${Math.round(d.age15||15)}分钟新增消耗 TOP -->
<div class="section">
  <h2>📊 近${Math.round(d.age15||15)}分钟新增消耗 TOP</h2>
  <table>
    <thead><tr><th>计划名称/ID</th><th>趋势</th><th>累计消耗</th><th>${Math.round(d.age15||15)}m新增</th><th>环比变化</th><th>转化(条)</th><th>CPL</th><th>预算使用</th></tr></thead>
    <tbody>${campaignRows}</tbody>
  </table>
</div>

<!-- 起量 + 掉量 -->
<div class="grid2">
  <div class="section">
    <h2>🚀 起量 <span class="count">>30% | ${(rampingUp||[]).length}条</span></h2>
    <table>
      <thead><tr><th>计划</th><th>消耗</th><th>${Math.round(d.age15||15)}m新增</th><th>环比</th><th>CPL</th></tr></thead>
      <tbody>${(rampingUp||[]).length > 0 ? (rampingUp||[]).map(c => `
      <tr>
        <td title="${escHtml(c.name)}">${escHtml(c.name.slice(0, 35))}</td>
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
      <thead><tr><th>计划</th><th>消耗</th><th>${Math.round(d.age15||15)}m新增</th><th>环比</th><th>CPL</th></tr></thead>
      <tbody>${(dropping||[]).length > 0 ? (dropping||[]).map(c => `
      <tr>
        <td title="${escHtml(c.name)}">${escHtml(c.name.slice(0, 35))}</td>
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
  WorkBuddy 自动监控 · ${today} · 巨量引擎 ${CONFIG.accountName} · ${liveWin.label} · 按真实时间差环比 · 离线快照
  <br>建议反馈通过飞书卡片 是/否 按钮收集 · (离线快照，无外部链接) · <a href="oceanengine-daily-${today}.html" style="color:#10b981;font-weight:bold">📊 今日日报(23:05生成)</a>
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
    avgCTR: analysis.summary.avgCTR || 0,
    avgCVR: analysis.summary.avgCVR || 0,
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
    idealSpend: analysis.delta?.idealSpend || 0,
    projectedDaily: analysis.delta?.projectedDaily || 0,
    pacingRatio: analysis.delta?.pacingRatio || 0,
    lifecycle: analysis.delta?.lifecycle || {},
    yoy: analysis.delta?.yoy || null,
    totalLeads: analysis.summary.totalLeads || 0,
    openRetainRate: analysis.summary.openRetainRate || 0,
    // 漏斗原始计数 (2026-06-16 新增, 供多日基线精确对比)
    totalPrivateMsgOpen: analysis.summary.totalPrivateMsgOpen || 0,
    totalPrivateMsgRetain: analysis.summary.totalPrivateMsgRetain || 0,
    totalFormSubmit: analysis.summary.totalFormSubmit || 0,
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
// Level 2: 中等告警 → 30分钟间隔
// Level 3: 正常 → 60分钟常规播报
const LAST_PUSH_FILE = path.join(DATA_DIR, 'last-push.json');

function loadLastPush() {
  try { if (fs.existsSync(LAST_PUSH_FILE)) return JSON.parse(fs.readFileSync(LAST_PUSH_FILE, 'utf-8')); } catch {}
  return { timestamp: 0, level: 0 };
}
function saveLastPush(state) { atomicWriteJSON(LAST_PUSH_FILE, state); }

// ====== 推送日志（仪表盘飞书推送板块） ======
const PUSH_LOG_FILE = path.join(DATA_DIR, 'push-log.json');
const PUSH_TYPES = { MAIN: '主力监控', BALANCE: '余额告警', BUDGET: '预算告警', DAILY: '日报', SUMMARY: '日结' };
function appendPushLog(type, status, detail, analysis) {
  try {
    let log = { entries: [] };
    if (fs.existsSync(PUSH_LOG_FILE)) {
      try { log = JSON.parse(fs.readFileSync(PUSH_LOG_FILE, 'utf-8')); } catch {}
    }
    const now = new Date();
    const anchor = analysis.currentAnchor || getCurrentAnchorName() || '';
    const summary = analysis.summary || {};
    log.entries.push({
      time: now.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      type,
      anchor,
      status,
      detail,
      spend: summary.totalSpend || summary.totalSpending || 0,
      leads: summary.totalLeads || summary.totalConversions || 0,
    });
    // 保留最近 50 条（仪表盘只显示非 5min/15min，足够覆盖全天）
    if (log.entries.length > 50) log.entries = log.entries.slice(-50);
    atomicWriteJSON(PUSH_LOG_FILE, log);
  } catch (e) {
    console.warn(`  ⚠ 推送日志写入失败: ${e.message}`);
  }
}

function shouldPush(analysis) {
  // 空数据保护：无计划/无消耗时禁止推送，避免发送全零垃圾报告
  const hasData = (analysis.summary?.totalSpending ?? 0) > 0 || (analysis.summary?.totalSpend ?? 0) > 0;
  if (!hasData) {
    return { push: false, level: 0, reason: '页面数据为空(0计划/0消耗)，可能是表格未加载' };
  }

  const highCount = analysis.alerts.filter(a => a.severity === 'high').length;
  const midCount = analysis.alerts.filter(a => a.severity === 'medium').length;
  const last = loadLastPush();
  const now = Date.now();
  const elapsed = now - (last.timestamp || 0);
  const OEC_NO_THROTTLE = process.env.OEC_NO_THROTTLE === '1';
  const MIN_INTERVAL_MS = OEC_NO_THROTTLE ? 0 : (3 * 60 * 1000); // 飞书汇报最小间隔 3 分钟（OEC_NO_THROTTLE=1 关闭）

  // 所有级别统一先过最小间隔，避免连续运行导致刷屏
  if (!OEC_NO_THROTTLE && elapsed < MIN_INTERVAL_MS) {
    return { push: false, level: 0, reason: `距上次推送仅 ${(elapsed / 60000).toFixed(1)} 分钟，需间隔≥3分钟` };
  }

  // Level 1: 严重告警 → 间隔满足后立即推送
  if (highCount > 0) {
    return { push: true, level: 1, reason: `严重告警 ${highCount} 条` };
  }

  // Level 2: 中等告警 → 3分钟间隔
  if (midCount > 0) {
    return { push: true, level: 2, reason: `中等告警 ${midCount} 条` };
  }

  // Level 3: 无告警 → 3分钟常规播报
  return { push: true, level: 3, reason: '常规3分钟播报' };
}

// 构建飞书交互式卡片消息（v3：反馈按钮 + 历史参考 + 动态直播窗口）
async function buildFeishuCard(analysis) {
  const { summary, alerts, topNewSpenders: analysisTop5, rampingUp, dropping, delta } = analysis;

  // TOP5 从 DB 统一取数（近 15 分钟消耗增量）
  let dbTop5 = [];
  let db = null;
  try {
    db = new Database(path.join(DATA_DIR, 'oceanengine.db'), { readonly: true });
    // 取最近 3 个 5min 时刻，最早作为 prev，最新作为 curr
    const times = db.prepare(`
      SELECT DISTINCT snapshot_time FROM snapshots
      WHERE source_type = '5min'
      ORDER BY snapshot_time DESC LIMIT 3
    `).all();
    if (times.length >= 2) {
      const prevTime = times[times.length - 1].snapshot_time;
      const currTime = times[0].snapshot_time;
      // JOIN 写法：单次查询得到 delta，避免 N+1 子查询
      dbTop5 = db.prepare(`
        SELECT c.name,
          (curr.cost - COALESCE(prev.cost, 0)) as spendDelta,
          (curr.leads - COALESCE(prev.leads, 0)) as convDelta
        FROM snapshots curr
        LEFT JOIN snapshots prev
          ON curr.campaign_id = prev.campaign_id
          AND prev.snapshot_time = ? AND prev.source_type = '5min'
        INNER JOIN campaigns c ON curr.campaign_id = c.campaign_id
        WHERE curr.snapshot_time = ? AND curr.source_type = '5min'
        GROUP BY curr.campaign_id
        HAVING spendDelta > 0
        ORDER BY spendDelta DESC LIMIT 5
      `).all(prevTime, currTime);
    }
  } catch (e) {
    console.warn(`[card] DB TOP5 查询失败: ${e.message}`);
  } finally {
    if (db) { try { db.close(); } catch {} }
  }
  // 降级到 analysis 计算结果
  const topNewSpenders = dbTop5.length > 0 ? dbTop5 : analysisTop5;
  const now = new Date().toLocaleString('zh-CN');
  const d = delta || {};
  const liveWin = getLiveWindowLabel();
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
  const watchAlerts = alerts.filter(a => a.type === 'cpa_3h' || a.type === 'speed_3h' || a.type === 'conv_drop_3h' || a.type === 'burn_accel_3h' || a.type === 'cpa_vs_3d' || a.type === 'spend_vs_3d' || a.type === 'conv_vs_3d' || a.type === 'plan_count_drop' || a.type === 'retain_rate_drop' || a.type === 'cpm_spike' || a.type === 'view_retention_drop' || a.type === 'conv_efficiency_drop' || a.type === 'compound_risk' || a.type === 'cpa_trend' || a.type === 'spend_trend' || a.type === 'account_budget_cap' || a.type === 'balance_low');
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

  // ====== 核心指标 (累计 + 近15分钟快照差值) ======
  //
  // ━ 累计 ━
  // 消耗       summary.totalSpend                           API: collectAllData → totalMetrics.stat_cost
  // CPL        summary.avgCPA                              计算: totalSpend / totalConversions
  // 转化       summary.totalConversions                     API: totalMetrics.convert_cnt
  // 开口成本   totalSpend / totalPrivateMsgOpen             计算: 每产生一次开口对话的平均消耗
  // 开口留资率 openRetainRate * 100%                        计算: privateMsgRetain / privateMsgOpen
  //                                                         API: totalMetrics.message_action → 开口
  //                                                              totalMetrics.clue_message_count → 留资
  // ━ 近*d.age15*分差值 ━
  // 新增消耗   d.spendLast15min                            DB: 与前一次15分钟快照的差值
  // 新增线索   d.convLast15min                              DB: 与前一次15分钟快照的差值 (-1=数据不足)
  // CPL        d.cplLast15min                              计算: spendLast15min / convLast15min
  // CPM        summary.avgCPM                              累计值 (快照无展示数差值)
  // 停留率     summary.viewRetention                       累计值 (快照无观看数差值)
  // 速度       d.speedCurrent                              计算: spendLast15min / age15
  const metricsLines = [
    '━ **累计** ━',
    `💰 **消耗**: ¥${summary.totalSpend.toFixed(0)}${summary.useAccountSpend ? ' (账户)' : ''} | CPL ¥${summary.avgCPA.toFixed(0)}${cpaEmoji ? ' ' + cpaEmoji : ''}`,
    `🎯 **转化**: ${summary.totalConversions}条（线索数：${summary.totalLeads||0}条）`,
    `📨 **开口成本**: ¥${(summary.totalPrivateMsgOpen||0) > 0 ? (summary.totalSpend / summary.totalPrivateMsgOpen).toFixed(1) : '--'} | **开口留资率**: ${(summary.openRetainRate ? (summary.openRetainRate*100).toFixed(1) + '%' : 'N/A')}`,
    `━ **近${Math.round(d.age15||15)}分差值** ━`,
    `📊 **新增消耗**: +¥${d.spendLast15min.toFixed(0)} | **新增线索**: +${d.convLast15min === -1 ? '?' : d.convLast15min}条`,
    `📈 **CPL**: ¥${d.cplLast15min > 0 ? d.cplLast15min.toFixed(0) : '--'} | **CPM**: ¥${(summary.avgCPM||0).toFixed(1)} | **停留率**: ${summary.viewRetention ? (summary.viewRetention*100).toFixed(1)+'%' : 'N/A'}`,
    `⚡ **速度**: ¥${d.speedCurrent.toFixed(0)}/min${speedEmoji} | 有消耗 ${summary.totalSpending}条 · 投放中 ${summary.totalActive}条 (起量${rampingUp.length}·掉量${dropping.length})`,
  ];


  // ====== Section 3: 告警内容 ======
  const alertLines = [];
  if (infoAlerts.length > 0) {
    alertLines.push('🔵 **节奏提醒**');
    for (const a of infoAlerts) {
      alertLines.push(`ℹ ${a.name}: ${a.detail}`);
    }
  }

  // ====== Section 4: TOP新增消耗 + 趋势 ======
  const topLines = [];
  if (topNewSpenders.length > 0) {
    topLines.push(`📊 **近${Math.round(d.age15||15)}分钟新增消耗 TOP5**`);
    const trendTag = (t) => {
      if (t === '起量') return '🔥'; if (t === '掉量') return '📉';
      if (t === '稳定消耗') return '➡'; return '';
    };
    for (let i = 0; i < Math.min(5, topNewSpenders.length); i++) {
      const c = topNewSpenders[i];
      // 兼容 DB 查询结果（仅有 name/spendDelta/convDelta）和分析结果（含完整趋势数据）
      const rateStr = c.changeRate !== undefined
        ? (c.spendPrev > 0.01 ? `${(c.changeRate >= 0 ? '+' : '')}${(c.changeRate * 100).toFixed(0)}%` : 'NEW')
        : '';
      const cpaVal = c.cpa15 !== undefined ? c.cpa15 : (c.convDelta > 0 ? c.spendDelta / c.convDelta : 0);
      const cplRecentStr = c.convDelta > 0 ? `¥${cpaVal.toFixed(0)}` : '—';
      const tag = c.trend ? trendTag(c.trend) : (c.spendDelta > 50 ? '🔥' : c.spendDelta > 10 ? '➡' : '');
      topLines.push(`${i + 1}. ${tag} ${(c.name || '').slice(0, 30)} — ¥${c.spendDelta.toFixed(0)}${rateStr ? ' (' + rateStr + ')' : ''} · ${Math.round(d.age15||15)}mCPL ${cplRecentStr}`);
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

  // --- 计划状态变化提醒：投放中 -> 项目超出预算 ---
  if (analysis.budgetExceededChanges && analysis.budgetExceededChanges.length > 0) {
    elements.push({ tag: 'hr' });
    const lines = [`🔴 **预算超限提醒**：${analysis.budgetExceededChanges.length} 条计划刚从「投放中」变为「项目超出预算」`];
    for (const c of analysis.budgetExceededChanges.slice(0, 5)) {
      const pct = c.budget > 0 ? ((c.spend / c.budget) * 100).toFixed(0) : '--';
      lines.push(`  • ${c.name.slice(0, 30)} - 消耗 ¥${c.spend.toFixed(0)} / 预算 ¥${c.budget.toFixed(0)} (${pct}%)`);
    }
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: lines.join('\n') }
    });
  }

  // 可执行建议 (不在卡片中展示，仅通过 sendFeishuPush 发送)
  const pendingSuggestions = [];

  // --- TOP消耗 ---
  if (topLines.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: topLines.join('\n') }
    });
  }

  // --- 起量摘要 ---
  if (rampingUp.length > 0) {
    const trendLines = [`🔥 起量: ${rampingUp.slice(0, 3).map(c => c.name.slice(0, 25) + '+' + (c.changeRate*100).toFixed(0) + '%').join(', ')}`];
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

  // --- 多日基线 (近N天同时段) ---
  if (analysis._multiDay && analysis._multiDay.sampleDays >= 2) {
    const md = analysis._multiDay;
    const spendVsMeanNum = md.spend.mean > 0 ? ((summary.totalSpend / md.spend.mean - 1) * 100) : null;
    const spendVsMean = spendVsMeanNum !== null ? (spendVsMeanNum >= 0 ? '↑' : '↓') + Math.abs(spendVsMeanNum).toFixed(0) + '%' : '—';
    const cpaVsMeanNum = md.cpa && md.cpa.mean > 0 ? ((summary.avgCPA / md.cpa.mean - 1) * 100) : null;
    const cpaVsMean = cpaVsMeanNum !== null ? (cpaVsMeanNum >= 0 ? '↑' : '↓') + Math.abs(cpaVsMeanNum).toFixed(0) + '%' : '—';
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `📊 **近${md.sampleDays}天同时段**\n消耗: ¥${md.spend.mean.toFixed(0)} → ¥${summary.totalSpend.toFixed(0)} (${spendVsMean}) | CPL: ¥${(md.cpa?.mean||0).toFixed(0)} → ¥${summary.avgCPA.toFixed(0)} (${cpaVsMean})` }
    });
  }

  // --- 计划状态 ---
  if (d.lifecycle && d.lifecycle.dead > 0) {
    elements.push({ tag: 'hr' });
    const lcParts = [];
    if (d.lifecycle.active > 0) lcParts.push(`🔥 活跃 ${d.lifecycle.active}`);
    if (d.lifecycle.dead > 0) lcParts.push(`💀 疑似死亡 ${d.lifecycle.dead}`);
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `📊 **计划状态**: ${lcParts.join(' · ')}` }
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

  // --- 底部提示：HTML 报表开关状态 ---
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'note',
    elements: [
      { tag: 'plain_text', content: CONFIG.enableHtmlReport ? ' 详实报表已发送为HTML文件，可在群聊中下载查看' : ' 详实报表已关闭，仅展示关键摘要' }
    ]
  });

  // --- 脚注 ---
  elements.push({
    tag: 'note',
    elements: [
      { tag: 'plain_text', content: `🕐 ${now} · ${d.timeSlot || ''} · ${liveWin.labelCompact} · 点击按钮反馈建议` }
    ]
  });

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${PM2_PREFIX}${statusIcon} 极狐直播 · ${alertSummary}${d.timeSlot ? ' · ' + d.timeSlot : ''}` },
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

// 时段盯盘建议（由排班表动态计算）
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

// ====== 账户余额专用卡片推送（独立于常规监控，专用告警通道） ======
const BALANCE_ALERT_FILE = path.join(DATA_DIR, 'balance-alert-last.json');

function loadBalanceAlertState() {
  try { if (fs.existsSync(BALANCE_ALERT_FILE)) return JSON.parse(fs.readFileSync(BALANCE_ALERT_FILE, 'utf-8')); } catch {}
  return { lastPush: 0, lastSeverity: '' };
}

function saveBalanceAlertState(state) { atomicWriteJSON(BALANCE_ALERT_FILE, state); }

async function sendBalanceAlert(analysis) {
  const balanceAlerts = analysis.alerts.filter(a => a.type === 'balance_low');
  if (balanceAlerts.length === 0) return false;

  const worst = balanceAlerts.reduce((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.severity] < order[b.severity] ? a : b;
  });

  // 余额专用节流：同一严重度2小时内不重复推送；严重度升级时立即推送
  const state = loadBalanceAlertState();
  const now = Date.now();
  const severityOrder = { high: 0, medium: 1, low: 2 };
  const currentLevel = severityOrder[worst.severity] ?? 2;
  const lastLevel = severityOrder[state.lastSeverity] ?? 3;

  if (currentLevel >= lastLevel && now - state.lastPush < 2 * 60 * 60 * 1000) {
    console.log(`  💳 余额告警抑制: 距上次同级别推送仅 ${((now - state.lastPush) / 60000).toFixed(0)} 分钟`);
    return false;
  }

  // 低级别(<2天不触发独立推送，走常规卡片即可)
  if (worst.severity === 'low') {
    return false;
  }

  if (!CONFIG.larkCli) return false;

  const d = analysis.delta || {};
  const daysRemaining = worst.daysRemaining || 0;
  const isCritical = worst.severity === 'high';
  const headerColor = isCritical ? 'red' : 'orange';
  const statusIcon = isCritical ? '🔴' : '🟡';
  const urgencyLabel = isCritical ? '⚠️ 立即充值' : '⚡ 尽快充值';

  const balanceCard = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${statusIcon} 账户余额告警 · ${urgencyLabel}` },
      template: headerColor,
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: [
          `## 💳 主账户余额告警`,
          ``,
          `**当前余额**: ¥${(analysis.summary?.accountBalance || 0).toFixed(0)}`,
          `**可支撑**: 约 **${daysRemaining.toFixed(1)} 天**`,
          `**预估日耗**: ¥${(worst.projectedDaily || 0).toFixed(0)}`,
          `**日预算**: ¥${(d.dailyBudget || 45000).toFixed(0)}`,
          ``,
          isCritical
            ? `> ⚠️ **余额不足支撑1天消耗，计划可能随时因余额不足暂停投放！**`
            : `> ⚠️ 余额仅能支撑约 ${daysRemaining.toFixed(1)} 天，请尽快安排充值避免断投。`,
          ``,
          `📊 **今日进度**: 消耗 ¥${(analysis.summary?.totalSpend || 0).toFixed(0)} / ¥${(d.dailyBudget || 45000).toFixed(0)} (${(d.budgetUsed * 100).toFixed(0)}%)`,
          `⏰ ${new Date().toLocaleString('zh-CN')} · ${d.timeSlot || ''}`,
        ].join('\n') },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: { tag: 'lark_md', content: `🔗 [打开投放管理页](${CONFIG.campaignUrl})  |  \`/充值\` 查看充值指引` },
      },
      {
        tag: 'note',
        elements: [{ tag: 'plain_text', content: '💳 余额专用告警 · 独立于常规监控 · 每2小时最多推送1次（严重度升级除外）' }],
      },
    ],
  };

  try {
    const pushResult = await pushCard(CONFIG.larkCli, balanceCard, CONFIG.feishuChatId, {
      timeoutMs: 15000,
      maxRetries: 2,
    });

    if (pushResult.ok) {
      saveBalanceAlertState({ lastPush: now, lastSeverity: worst.severity, balance: analysis.summary?.accountBalance, daysRemaining });
      console.log(`  💳 余额专用告警已推送 [${worst.severity}] · 余额 ¥${(analysis.summary?.accountBalance||0).toFixed(0)} · 约${daysRemaining.toFixed(1)}天`);
      return true;
    }
    console.log(`  ❌ 余额告警推送失败: ${pushResult.error}`);
  } catch (e) {
    console.log(`  ❌ 余额告警推送异常: ${e.message?.slice(0, 80)}`);
  }
  return false;
}

// ====== 账户日预算撞线专用卡片推送（独立于常规监控，专用告警通道） ======
const ACCOUNT_BUDGET_ALERT_FILE = path.join(DATA_DIR, 'account-budget-alert-last.json');

function loadAccountBudgetAlertState() {
  try { if (fs.existsSync(ACCOUNT_BUDGET_ALERT_FILE)) return JSON.parse(fs.readFileSync(ACCOUNT_BUDGET_ALERT_FILE, 'utf-8')); } catch {}
  return { lastPush: 0, lastSeverity: '', lastPct: 0 };
}

function saveAccountBudgetAlertState(state) { atomicWriteJSON(ACCOUNT_BUDGET_ALERT_FILE, state); }

async function sendAccountBudgetAlert(analysis) {
  const accountBudgetAlerts = analysis.alerts.filter(a => a.type === 'account_budget_cap');
  if (accountBudgetAlerts.length === 0) return false;

  const summary = analysis.summary || {};
  const accountSpend = summary.accountSpend || 0;
  const accountBudget = summary.accountBudget || 0;
  if (accountBudget <= 0) return false;

  const usedPct = accountSpend / accountBudget;
  // 阶梯阈值: >=95% high(红) / >=85% medium(橙) / <85% 不独立推送
  const severity = usedPct >= 0.95 ? 'high' : usedPct >= 0.85 ? 'medium' : 'low';
  if (severity === 'low') return false;

  // 节流：同严重度1小时内不重复；升级立即推
  const state = loadAccountBudgetAlertState();
  const now = Date.now();
  const severityOrder = { high: 0, medium: 1, low: 2 };
  const currentLevel = severityOrder[severity] ?? 2;
  const lastLevel = severityOrder[state.lastSeverity] ?? 3;

  if (currentLevel >= lastLevel && now - state.lastPush < 60 * 60 * 1000) {
    console.log(`  💰 账户日预算告警抑制: 距上次同级别推送仅 ${((now - state.lastPush) / 60000).toFixed(0)} 分钟`);
    return false;
  }

  if (!CONFIG.larkCli) return false;

  const d = analysis.delta || {};
  const projectedDaily = d.projectedDaily || 0;
  const overSpend = projectedDaily > accountBudget ? projectedDaily - accountBudget : 0;
  const isCritical = severity === 'high';
  const headerColor = isCritical ? 'red' : 'orange';
  const statusIcon = isCritical ? '🔴' : '🟡';
  const urgencyLabel = isCritical ? '⚠️ 立即追加预算' : '⚡ 尽快追加预算';

  // 找出消耗最高的活跃计划
  const topCampaign = (analysis.allSpending || analysis.active || [])
    .filter(c => c.status === '投放中' || c.status === '启用')
    .sort((a, b) => (b.spend || 0) - (a.spend || 0))[0] || null;

  const topCampaignLine = topCampaign
    ? `🔥 最高消耗: ${topCampaign.name} (¥${(topCampaign.spend||0).toFixed(0)} / 计划预算 ¥${(topCampaign.budget||0).toFixed(0)})`
    : '';

  // 找出接近撞线的计划 (>=80% 计划预算)
  const nearCapPlans = (analysis.allSpending || [])
    .filter(c => c.budget > 0 && (c.spend / c.budget) >= 0.8 && c.status === '投放中')
    .sort((a, b) => (b.spend / b.budget) - (a.spend / a.budget))
    .slice(0, 3);
  const nearCapLines = nearCapPlans.length > 0
    ? ['', '📊 **接近撞线计划** (≥80%):', ...nearCapPlans.map(p => `  · ${p.name}: ¥${(p.spend||0).toFixed(0)}/¥${p.budget.toFixed(0)} (${((p.spend/p.budget)*100).toFixed(0)}%)`)]
    : [];

  const cardLines = [
    `## 💰 账户日预算撞线`,
    ``,
    `**使用率**: **${(usedPct * 100).toFixed(1)}%**  (¥${accountSpend.toFixed(0)} / ¥${accountBudget.toFixed(0)})`,
    `**预估今日**: ¥${projectedDaily.toFixed(0)}` + (overSpend > 0 ? `  ⚠️ 超预算 ¥${overSpend.toFixed(0)}` : ''),
    `**时间进度**: ${((d.timeProgress||0) * 100).toFixed(0)}%  (${(d.elapsedHours||0).toFixed(1)}h/${d.windowDuration||16}h)`,
    topCampaignLine,
    ...nearCapLines,
    ``,
    isCritical
      ? `> ⚠️ **账户预算即将/已用完，所有计划将陆续暂停投放！**`
      : `> ⚠️ 账户预算使用率 ${(usedPct*100).toFixed(0)}%，按当前节奏预估今日 ¥${projectedDaily.toFixed(0)}。`,
    ``,
    `📌 **建议操作**:`,
    `1. 追加账户日预算（投放管理 → 账户设置）`,
    `2. 或调低高消耗计划预算上限`,
    `3. 或暂停部分非核心计划`,
    ``,
    `⏰ ${new Date().toLocaleString('zh-CN')} · ${d.timeSlot || ''}`,
  ].filter(Boolean);

  const accountBudgetCard = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${statusIcon} 账户日预算告警 · ${urgencyLabel}` },
      template: headerColor,
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: cardLines.join('\n') },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: { tag: 'lark_md', content: `🔗 [打开投放管理页](${CONFIG.campaignUrl})  |  [查看完整报表](http://127.0.0.1:8899/report)` },
      },
      {
        tag: 'note',
        elements: [{ tag: 'plain_text', content: '💰 账户日预算专用告警 · 独立于常规监控 · 每1小时最多推送1次（严重度升级除外）' }],
      },
    ],
  };

  try {
    const pushResult = await pushCard(CONFIG.larkCli, accountBudgetCard, CONFIG.feishuChatId, {
      timeoutMs: 15000,
      maxRetries: 2,
    });

    if (pushResult.ok) {
      saveAccountBudgetAlertState({ lastPush: now, lastSeverity: severity, lastPct: usedPct, spend: accountSpend, budget: accountBudget, projected: projectedDaily });
      console.log(`  💰 账户日预算专用告警已推送 [${severity}] · 使用率 ${(usedPct*100).toFixed(0)}% · 预估 ¥${projectedDaily.toFixed(0)}`);
      return true;
    }
    console.log(`  ❌ 账户日预算告警推送失败: ${pushResult.error}`);
  } catch (e) {
    console.log(`  ❌ 账户日预算告警推送异常: ${e.message?.slice(0, 80)}`);
  }
  return false;
}

async function sendFeishuPush(analysis) {
  // 诊断日志：记录为何跳过推送
  console.log(`  🔍 [诊断] larkCli=${CONFIG.larkCli ? CONFIG.larkCli.replace(/^.*[\\/]/, '') : '∅'} | hasData=${
    (analysis.summary?.totalSpend ?? 0) > 0 || (analysis.summary?.totalSpending ?? 0) > 0
  } | alerts=${analysis.alerts?.length ?? 0}`);

  if (!CONFIG.larkCli) {
    // 重试 findLarkCli (初次调用可能因并发锁失败)
    for (let retry = 0; retry < 2; retry++) {
      await sleep(1000);
      const retried = findLarkCli();
      if (retried) {
        CONFIG.larkCli = retried;
        console.log(`  🔄 lark-cli 重试${retry+1}次后找到: ${retried.replace(/^.*[\\/]/, '')}`);
        break;
      }
    }
    if (!CONFIG.larkCli) {
      console.log('  ⚠ lark-cli 不可用，跳过飞书推送 (findLarkCli 返回空，已重试2次)');
      return false;
    }
  }

  if (OEC_DRY_RUN) {
    console.log('  🧪 OEC_DRY_RUN=1，跳过飞书推送');
    const cardObj = await buildFeishuCard(analysis);
    const preview = JSON.stringify(cardObj).slice(0, 200);
    console.log(`  📋 卡片预览: ${preview}...`);
    return false;
  }

  const check = shouldPush(analysis);
  if (!check.push) {
    console.log(`  📨 飞书推送跳过: ${check.reason}`);
    // 余额告警独立于常规推送，即使常规被节流仍需发送
    await sendBalanceAlert(analysis);
    // 账户日预算告警独立通道
    await sendAccountBudgetAlert(analysis);
    return false;
  }

  // 确保反馈服务器运行
  await guardFeedbackServer();

  const cardObj = await buildFeishuCard(analysis);
  const pending = cardObj._pendingSuggestions || [];
  delete cardObj._pendingSuggestions; // 移除内部字段

  // 使用 guardedFeishuPush：自带超时、熔断、成本 guardrail、失败 fallback
  const pushResult = await pushCard(CONFIG.larkCli, cardObj, CONFIG.feishuChatId, {
    timeoutMs: 20000,
    maxRetries: 1,
    circuitFailureThreshold: 2,
    circuitFailureWindow: 4,
    circuitOpenDurationMs: 60_000,
  });

  if (pushResult.ok) {
    const levelTag = check.level === 1 ? '🔴严重' : '🟡中等';
    console.log(`  📨 飞书推送成功 [${levelTag} L${check.level}]`);
    // 记录推送时间，用于频率控制
    saveLastPush({ timestamp: Date.now(), level: check.level });
    // 写入仪表盘推送日志
    appendPushLog(PUSH_TYPES.MAIN, 'ok', `${levelTag} L${check.level}`, analysis);
    // 记录本次推送的待处理建议
    if (pending.length > 0) {
      recordPendingSuggestions(pending);
      console.log(`  📋 已记录 ${pending.length} 条待处理建议`);
    }

    // 截图附送已禁用（2026-06-27）
    // if (check.level === 1) { ... }

    // 独立余额告警（不依赖常规推送结果）
    await sendBalanceAlert(analysis);
    // 账户日预算告警独立通道
    await sendAccountBudgetAlert(analysis);
    return true;
  }

  console.log(`  ❌ 飞书推送异常: ${pushResult.error || 'unknown'}`);
  appendPushLog(PUSH_TYPES.MAIN, 'fail', pushResult.error || 'unknown', analysis);
  if (pushResult.fallback) {
    console.log(`  📁 已 fallback 到本地日志: ${pushResult.path}`);
  }
  // 即使常规推送失败，余额告警仍需独立发送
  await sendBalanceAlert(analysis);
  // 账户日预算告警独立通道
  await sendAccountBudgetAlert(analysis);
  return false;
}

// 余额告警独立入口：常规推送被跳过后仍可通过 OEC_BALANCE_ALERT=1 强制触发
async function sendBalanceAlertOnSkip(analysis) {
  const balanceAlerts = analysis.alerts.filter(a => a.type === 'balance_low');
  if (balanceAlerts.length === 0) return;
  await sendBalanceAlert(analysis);
}

// 账户日预算告警独立入口：常规推送被跳过后仍可通过 OEC_ACCOUNT_BUDGET_ALERT=1 强制触发
async function sendAccountBudgetAlertOnSkip(analysis) {
  const accountBudgetAlerts = analysis.alerts.filter(a => a.type === 'account_budget_cap');
  if (accountBudgetAlerts.length === 0) return;
  await sendAccountBudgetAlert(analysis);
}

// ====== 发送 HTML 报表文件到飞书群聊 ======
async function sendReportFileToChat() {
  if (!CONFIG.larkCli) {
    console.log('  ⚠ lark-cli 不可用，跳过报表文件发送');
    return false;
  }
  const htmlFile = path.join(CONFIG.reportDir, 'oceanengine-report.html');
  if (!fs.existsSync(htmlFile)) {
    console.log('  ⚠ 报表文件不存在，跳过发送');
    return false;
  }

  const result = await pushFile(CONFIG.larkCli, htmlFile, CONFIG.feishuChatId, CONFIG.reportDir, {
    timeoutMs: 30000,
    maxRetries: 1,
  });

  if (result.ok) {
    console.log('  📄 详实报表HTML文件已发送到群聊');
    return true;
  }
  console.log(`  ❌ 报表文件发送异常: ${result.error || 'unknown'}`);
  if (result.fallback) {
    console.log(`  📁 已 fallback 到本地日志: ${result.path}`);
  }
  return false;
}

// ====== 测试模式 ======
const OEC_FORCE = process.env.OEC_FORCE === '1';
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === '1';

// ====== 主流程 ======
async function main() {
  const startTime = Date.now();

  if (OEC_FORCE || OEC_DRY_RUN) {
    console.log(`  🧪 测试模式: OEC_FORCE=${OEC_FORCE} OEC_DRY_RUN=${OEC_DRY_RUN}`);
  }

  // ====== 0.0 写入本轮日志分隔线（追加模式，保留历史） ======
  try { fs.appendFileSync(LOG_FILE, `\n=== ${new Date().toLocaleString()} ===\n`); } catch {}
  // 日志文件过大时截断保留最近500KB
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > 1024 * 1024) {
      const buf = fs.readFileSync(LOG_FILE, 'utf8');
      const keep = buf.slice(-500 * 1024);
      fs.writeFileSync(LOG_FILE, keep);
    }
  } catch {}

  // ====== 0. 动态直播状态检查（替代固定时间窗口） ======
  const now = new Date();
  let isLive = false;
  let roomTitle = '';
  if (!OEC_FORCE) {
    try {
      const roomClient = await createApiClient({ useCache: true });
      const onlineRooms = await getOnlineRoomList(roomClient);
      if (onlineRooms.length > 0) {
        const roomStatus = await getLiveRoomStatus(roomClient, onlineRooms[0].room_id);
        isLive = roomStatus?.is_live || false;
        roomTitle = roomStatus?.room_title || '';
      } else {
        // API 返回空列表默认为开播（直播排班窗口内应视为在线）
        isLive = true;
        console.log('  ℹ 直播列表为空，按排班窗口视为在线');
      }
    } catch (e) { console.log(`  ⚠ 直播状态查询失败: ${e.message?.slice(0, 80)}，继续执行`); isLive = true; }
    if (!isLive) {
      console.log(`[${now.toLocaleTimeString()}] ⓪ 直播间未开播，静默退出`);
      process.exit(0);
    }
    console.log(`[${now.toLocaleTimeString()}] ✅ 直播间在线: ${roomTitle}`);
  } else {
    console.log(`[${now.toLocaleTimeString()}] 🧪 OEC_FORCE=1 强制绕过直播状态检查`);
  }

  console.log(`\n[${new Date().toLocaleTimeString()}] 🚀 巨量引擎监控启动 (v5: 纯 HTTP API)`);

  // ====== 1. Chrome 9222 检查 ======
  // v4: HTTP API 是主方案，CDP仅作降级——但CDP仍需要Chrome运行（Cookie提取/自动登录）
  if (!fs.existsSync(CONFIG.dataDir)) fs.mkdirSync(CONFIG.dataDir, { recursive: true });

  // ====== 2. 数据采集：HTTP API 优先，CDP 降级 ======
  let campaigns = [];
  let accountSpend = 0, accountBudget = 0, accountBalance = 0;
  let pageSummary = null;
  let collectionMethod = 'unknown';
  let client = null; // CDP client (only used in fallback)
  let apiClient = null;

  // --- 主方案：HTTP API ---
  try {
    console.log('  📡 尝试 HTTP API 采集...');
    apiClient = await createApiClient({ useCache: true });
    const apiData = await collectAllData(apiClient);

    if (apiData.campaigns && apiData.campaigns.length > 0) {
      campaigns = apiData.campaigns;
      accountSpend = apiData.accountSpend;
      accountBudget = apiData.accountBudget;
      accountBalance = apiData.accountBalance;
      pageSummary = apiData.pageSummary;
      collectionMethod = 'http_api';
      console.log(`  ✅ HTTP API 采集成功 (${apiData.elapsed}s)`);
    } else {
      console.log('  ⚠ HTTP API 返回空数据，5分钟速报将兜底');
    }
  } catch (apiErr) {
    console.log(`  ⚠ HTTP API 失败: ${apiErr.message?.slice(0, 80)} | 5分钟速报兜底`);
    if (apiErr.message?.includes('未找到巨量引擎标签页') || apiErr.message?.includes('AUTO_LOGIN_FAILED')) {
      console.log('  ℹ 纯 HTTP API 模式，跳过重试');
    }
  }

  // --- 纯 HTTP API 模式：不降级到 CDP ---
  // CDP 降级已禁用。若 HTTP API 失败则本次采集中断，由 5 分钟速报兜底。
  if (campaigns.length === 0 && false) {  // CDP fallback disabled
    console.log('  🔄 降级到 CDP 方案...');
    collectionMethod = 'cdp_fallback';

    // Chrome 检查 + 自动拉起
    const chromeAlive = await checkChrome();
    if (!chromeAlive) {
      console.log('  ❌ Chrome 9222 端口未开启');
      const launched = await launchChrome();
      if (!launched) {
        console.log('  ⛔ Chrome 自动拉起失败，记录数据断层');
        recordDataGap('Chrome未运行且自动拉起失败');
        process.exit(1);
      }
      await sleep(8000);
    }

    const connResult = await quickConnectWithRetry({ maxRetries: 3, retryDelay: 2000 });
    if (!connResult) {
      console.log('  ⛔ CDP连接失败，记录数据断层');
      recordDataGap('CDP连接失败');
      process.exit(1);
    }

    client = connResult.client;
    const tab = connResult.tab;

    // 导航/刷新
    const isCorrectPage = tab.url?.includes('promotion/promote-manage/project');
    if (!isCorrectPage) {
      console.log('  导航到投放管理页...');
      await client.call('Page.navigate', { url: CONFIG.campaignUrl });
      await sleep(6000);
      await closePopups(client);
      await sleep(1000);
    }

    console.log('  强制刷新...');
    await client.evalJs('location.reload(true)');
    await sleep(5000);
    await closePopups(client); await sleep(500);
    await waitForTableReady(client, 60000);

    console.log('  🔬 数据一致性校验...');
    await ensureDataConsistency(client, 3);
    await setPageSize(client, 50);
    await sortBySpend(client);

    // CDP 抓取
    const scrapePageSafe = async (pageLabel) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const pageResult = await scrapeOnePage(client);
          if (pageResult.campaigns?.length > 0 || attempt >= 2) return pageResult;
          console.log(`  ⚠ ${pageLabel}抓取为空，重试...`);
          await sleep(2000);
        } catch (e) {
          if (attempt >= 2) return { campaigns: [], accountSpend: 0, accountBudget: 0 };
          await sleep(1500);
        }
      }
      return { campaigns: [], accountSpend: 0, accountBudget: 0 };
    };

    const result = await scrapePageSafe('第1页');
    campaigns = result.campaigns || [];
    accountSpend = result.accountSpend || 0;
    accountBudget = result.accountBudget || 0;
    accountBalance = result.accountBalance || 0;

    let pageCount = 1;
    const MAX_PAGES = 10;
    while (pageCount < MAX_PAGES) {
      let hasNext;
      for (let i = 0; i < 3; i++) { hasNext = await hasNextPage(client); if (hasNext !== undefined) break; await sleep(1000); }
      if (!hasNext) break;
      pageCount++;
      await clickNextPage(client);
      const nextResult = await scrapePageSafe(`第${pageCount}页`);
      const activeNext = (nextResult.campaigns || []).filter(c => c.spend > 0);
      if (activeNext.length > 0) {
        campaigns = [...campaigns, ...nextResult.campaigns];
      } else {
        break;
      }
      if (accountSpend === 0 && nextResult.accountSpend > 0) accountSpend = nextResult.accountSpend;
    }
  }

  console.log(`  📦 采集完成: ${campaigns.length} 条计划 | 消耗 ¥${accountSpend.toFixed(2)} | 方案: ${collectionMethod}`);

  
  // 分析 (传入账户级数据和页面汇总行)
  const analysis = analyzeData(campaigns, accountSpend, accountBudget, accountBalance, pageSummary);
  
  // 保存完整数据
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const jsonFile = path.join(CONFIG.dataDir, `${timestamp}.json`);
  // 双通道独立写入: JSON 失败不阻塞 SQLite，SQLite 失败不阻塞 JSON
  let jsonOk = false;
  try {
    atomicWriteJSON(jsonFile, analysis);
    jsonOk = true;
  } catch (e) {
    console.warn(`  ⚠ JSON 快照写入失败: ${e.message}`);
  }
  // SQLite 双写 (独立 try)
  try {
    const r = insertSnapshot(analysis, timestamp);
    if (r.ok && r.rows > 0) {
      const v = verifyConsistency(analysis, timestamp);
      if (!v.ok && v.warn) {
        console.warn(`  ⚠ SQLite一致性校验: ${v.warn}`);
      }
      console.log(`  📊 SQLite双写: ${r.rows} 条 (jsonOk=${jsonOk})`);
    }
  } catch (e) {
    console.warn(`  ⚠ SQLite 双写失败: ${e.message}`);
  }
  
  // 每日趋势日志
  saveDailyLog(analysis);
  
  // 生成报表（原子写入，避免生成一半被读取）
  let htmlFile = '';
  if (CONFIG.enableHtmlReport) {
    const html = generateHTML(analysis);
    htmlFile = path.join(CONFIG.reportDir, 'oceanengine-report.html');
    const htmlTmp = htmlFile + '.tmp';
    fs.writeFileSync(htmlTmp, html);
    fs.renameSync(htmlTmp, htmlFile);
  }
  
  // 截图（仅CDP模式有截图能力）
  const screenshotPromise = (async () => {
    if (client) {
      try {
        const ssData = await client.screenshot();
        if (ssData) {
          fs.writeFileSync(path.join(CONFIG.reportDir, 'oceanengine-latest.png'), Buffer.from(ssData, 'base64'));
        }
      } catch {}
    }
  })();

  await screenshotPromise;

  // 关闭CDP连接（如果存在）
  if (client) client.close();
  
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
  console.log(`║  ${Math.round(d.age15||15)}m新增: ¥${(d.spendLast15min||0).toFixed(0).padStart(10)}             ║`);
  console.log(`║  总转化: ${String(s.totalConversions).padStart(6)}条  CPL: ¥${s.avgCPA.toFixed(2).padStart(8)}     ║`);
  console.log(`║  近${Math.round(d.age15||15)}m: ${d.convLast15min === -1 ? '数据不足'.padStart(8) : String(d.convLast15min||0).padStart(4) + '条转化'}  ${d.convLast15min === -1 ? ''.padStart(10) : Math.round(d.age15||15)+'m CPL: ¥' + (d.cplLast15min||0).toFixed(2).padStart(8)}   ║`);
  
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
  if (s.accountBalance > 0) {
    const daysBal = d.projectedDaily > 0 ? (s.accountBalance / d.projectedDaily).toFixed(1) + '天' : '—';
    console.log(`║  账户余额: ¥${s.accountBalance.toFixed(0).padStart(10)}  (约${daysBal})                  ║`);
  }
  console.log(`║  节奏健康: ${(d.pacingHealth||'N/A').padStart(6)}  时段: ${(d.timeSlot||'N/A').padStart(8)}     ║`);
  console.log(`║  告警数:  ${String(analysis.alerts.length).padStart(6)}                   ║`);
  const lc = d.lifecycle || {};
  const lcStr = `🔥${lc.active||0} 💀${lc.dead||0}`;
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

  // 发送离线快照HTML文件到群聊（仅当开启且有效数据时）
  if (CONFIG.enableHtmlReport) {
    const hasData = (analysis.active?.length > 0 && analysis.summary?.totalSpend > 0);
    if (hasData) {
      await sendReportFileToChat();
    } else {
      console.log('  ⏭ 无有效数据，跳过报表文件发送');
    }
  } else {
    console.log('  ⏭ HTML 报表已关闭，跳过报表文件发送');
  }
  
  if (htmlFile) {
    console.log(`\n📄 报表: ${htmlFile}`);
  }
  console.log(`⏱ 耗时: ${elapsed}s`);

  // 15min 进程末尾刷新物化视图 (增量)
  try {
    const r = refreshMaterialized();
    if (r.ok) {
      console.log(`📊 物化视图刷新: hourly=${r.hours}, daily=${r.days}, alerts=${r.alerts}`);
    } else {
      console.warn(`  ⚠ 物化视图刷新失败: ${r.error}`);
    }
  } catch (e) {
    console.warn(`  ⚠ 物化视图刷新异常: ${e.message}`);
  }

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
