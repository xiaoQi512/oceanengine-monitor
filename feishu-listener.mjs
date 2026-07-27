// feishu-listener.mjs — 飞书群消息监听 + 三阶段反馈闭环
// 轮询模式：每 10 秒拉取最新群消息，解析指令后按三阶段执行：
//   阶段1 确认: 回复「🔵 开始执行: [操作] [计划名]」
//   阶段2 执行: 调用 CDP 操作巨量引擎后台
//   阶段3 报告: 验证结果后回复「✅ 执行完成」或「❌ 执行失败」
//
// 支持指令：
//   1. 暂停/关停/恢复/加预算 → 直接操作指定计划
//   2. 拒绝/取消 → 移除队列队首 + 回写历史
//   3. 执行（无计划名）→ 取 action-queue 队首执行
//   4. 状态/帮助 → 查看队列与帮助

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync, spawn, exec } from 'child_process';
import { pushText } from './feishu-push-guard.mjs';
import { findLarkCli, loadSuggestionHistory, saveSuggestionHistory, recalcSummary, DATA_DIR, CHROME_USER_DATA_DIR, CHROME_PROFILE_DIRECTORY, findChromeExe, ACTION_AUDIT_FILE, ACTION_PENDING_FILE, initPendingFile } from './monitor-utils.mjs';
import { checkCDP } from './cdp-client.mjs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MONITOR_CHAT_ID = 'oc_8deeb3061bdbd43608de252a44c97a25';
const ANCHOR_CHAT_ID = 'oc_b245ee4b255c7b25b7f8d953802c49ff';
const CHAT_IDS = [MONITOR_CHAT_ID, ANCHOR_CHAT_ID];
var CHAT_NAMES = {}; CHAT_NAMES[MONITOR_CHAT_ID] = 'monitor'; CHAT_NAMES[ANCHOR_CHAT_ID] = 'anchor';
const STATE_FILE = path.join(__dirname, 'listener-state.json');
const STATE_FILE_ANCHOR = path.join(__dirname, 'listener-state-anchor.json');
const ACTION_QUEUE = path.join(__dirname, 'action-queue.json');
const LARK_CLI = findLarkCli() || 'lark-cli';

const SIMULATE_CDP = process.env.SIMULATE_CDP === '1';
if (SIMULATE_CDP) console.log('[listener] SIMULATE_CDP=1 - 跳过真实 CDP 操作');

const BOT_APP_ID = 'cli_a92d0bfc68f89cb2';

// ====== 队列入队 (替代直接调 cdp-action) ======

let queueWritePromise = Promise.resolve();
function withQueueLock(fn) {
  const p = queueWritePromise.then(fn).finally(() => {});
  queueWritePromise = p;
  return p;
}

function loadQueue() {
  try { return JSON.parse(fs.readFileSync(ACTION_QUEUE, 'utf8')); } catch { return { actions: [] }; }
}
function saveQueue(q) { fs.writeFileSync(ACTION_QUEUE, JSON.stringify(q, null, 2)); }

function enqueue(action) {
  // action: { type, planName, amount?, bid?, source, time, by }
  return withQueueLock(() => {
    const q = loadQueue();
    q.actions.push({
      time: new Date().toISOString(),
      source: action.source || 'feishu',
      by: action.by || 'unknown',
      type: action.type,
      planName: action.planName,
      amount: action.amount ?? null,
      bid: action.bid ?? null,
    });
    saveQueue(q);
    return q.actions.length;
  });
}

// L3 二次输入确认：飞书端走 confirmPopup（已在 cdp-action 内置），listener 层只做语义确认
// 这里通过 acknowledgeStart → 入队 → 等待 worker 执行 → 报告结果
// 队列模式下，worker 执行时会触发 cdp-action 内的 confirmPopupIfAny（L3）

// ====== Chrome 自动拉起 ======
async function ensureChromeCDP() {
  const status = await checkCDP();
  if (status.reachable) return { ok: true, action: 'already_running' };

  console.log('[listener] CDP 不可达，尝试自动拉起 Chrome...');

  const chromeExe = findChromeExe();
  if (!chromeExe) {
    const err = '未找到 Chrome 安装路径';
    console.error('[listener]', err);
    return { ok: false, err };
  }

  try {
    const userDataDir = CHROME_USER_DATA_DIR;
    const args = [
      `--remote-debugging-port=9222`,
      `--user-data-dir=${userDataDir}`,
      `--profile-directory=${CHROME_PROFILE_DIRECTORY}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--restore-last-session',
    ];

    const child = spawn(chromeExe, args, {
      detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.unref();

    // 等待 CDP 就绪，最多30秒
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await checkCDP().then(r => r.reachable)) {
        console.log('[listener] Chrome CDP 已就绪 (9222)');
        return { ok: true, action: 'launched' };
      }
    }

    const err = 'Chrome 启动超时，CDP 仍不可达';
    console.error('[listener]', err);
    return { ok: false, err };
  } catch (e) {
    const err = `Chrome 启动失败: ${e.message}`;
    console.error('[listener]', err);
    return { ok: false, err };
  }
}

// ====== 命令模式：严格前缀匹配，防止误触发 ======
const CMD_RULES = [
  {
    id: 'adjust_budget',
    re: /^\s*(加预算|增加预算|追加预算|adjust\s*budget)\s*/i,
    needAmount: true,
  },
  { id: 'stop', re: /^\s*(关停|关闭\s*计划|停止投放|stop|disable)\s*/i },
  { id: 'pause', re: /^\s*(暂停|pause)\s*/i },
  { id: 'resume', re: /^\s*(恢复|开启|启用|继续|resume|start)\s*/i },
  { id: 'reject', re: /^\s*(拒绝|取消|跳过|reject|no)\s*/i },
  { id: 'execute', re: /^\s*(执行|采纳|同意|confirm|yes)\s*/i },
  { id: 'info', re: /^(状态|status|队列|queue|帮助|help|\?)$/i },
];

// ====== 状态 / 消息 ======
function getStateFile(chatId) { return chatId === ANCHOR_CHAT_ID ? STATE_FILE_ANCHOR : STATE_FILE; }
function loadState(chatId) {
  try { return JSON.parse(fs.readFileSync(getStateFile(chatId), 'utf8')); } catch(e) { return { lastMsgId: null }; }
}
function saveState(st, chatId) { fs.writeFileSync(getStateFile(chatId), JSON.stringify(st, null, 2)); }


async function sendMsg(chatId, text) {
  if (!chatId) chatId = MONITOR_CHAT_ID;
  if (process.env.OEC_SILENT !== '1') console.log('  -->', text.replace(/\n/g, ' '));
  const r = await pushText(LARK_CLI, text, chatId, {
    timeoutMs: 15000, maxRetries: 1,
    circuitFailureThreshold: 2, circuitFailureWindow: 4,
    circuitOpenDurationMs: 60_000,
  });
  if (!r.ok) { console.error('[send] fail:', r.error); return false; }
  return true;
}

// ====== 表情反应：给收到的消息加表情（"收到，处理中"效果） ======
function addReaction(messageId, emojiType = 'Get') {
  if (!messageId) return;
  try {
    const r = spawnSync(LARK_CLI, [
      'im', 'reactions', 'create',
      '--params', JSON.stringify({ message_id: messageId }),
      '--data', JSON.stringify({ reaction_type: { emoji_type: emojiType } }),
    ], { encoding: 'utf8', cwd: __dirname, timeout: 10000, windowsHide: true });
    if (process.env.OEC_SILENT !== '1') {
      const ok = JSON.parse(r.stdout || '{}')?.ok;
      if (!ok) console.error('[react]', r.stdout?.substring(0, 200));
    }
  } catch (e) { console.error('[react]', e.message); }
}

async function fetchMessages(chatId, pageSize = 10) {
  try {
    const r = spawnSync(LARK_CLI, [
      'im', '+chat-messages-list', '--chat-id', chatId,
      '--page-size', String(pageSize), '--sort', 'desc',
    ], { encoding: 'utf8', cwd: __dirname, timeout: 10000, windowsHide: true });
    const out = (r.stdout || '').trim();
    if (!out) return [];
    const d = JSON.parse(out);
    return d?.ok ? (d?.data?.messages || []) : [];
  } catch (e) { console.error('[fetch]', e.message); return []; }
}

function msgText(msg) {
  try {
    var c$ = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
    return (c$.text || '').trim();
  } catch(e) {
    if (typeof msg.content === 'string') return msg.content.trim();
    if (msg.content && msg.content.text) return msg.content.text.trim();
    return '';
  }
}

function isBotMsg(msg, text) {
  return (msg.sender?.id === BOT_APP_ID)
    || (msg.sender?.sender_type === 'app')
    || (msg.sender?.id_type === 'app_id')
    || /^(✅|❌|ℹ️|⚠️|💬|📋|🧪|📁|🔵|\[listener\]|\[bot\])/.test(text);
}

function isAtMention(msg, text) {
  if (text.indexOf(BOT_APP_ID) >= 0) return true;
  try {
    var c$ = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
    if (c$.mentions) { for (var mi = 0; mi < c$.mentions.length; mi++) { if (c$.mentions[mi].id === BOT_APP_ID || c$.mentions[mi].key === BOT_APP_ID) return true; } }
  } catch(e) {}
  if (/@\u5c0f\u4e03/.test(text)) return true;
  return false;
}

function cleanAtText(text) {
  return text.replace(/<at[^>]*>[^<]*<\/at>/gi, '').replace(/@\u5c0f\u4e03\s*/g, '').trim();
}

// ====== 三阶段反馈：确认 → 执行 → 验证 → 报告 ======
// 阶段1: 收到指令后立即回复「开始执行」
async function acknowledgeStart(chatId, action, planName, detail) {
  const actionMap = { pause: '暂停', stop: '关停', resume: '恢复', adjust_budget: '加预算', reject: '拒绝', execute: '执行' };
  const actionText = actionMap[action] || action;
  let msg = `🔵 开始执行: ${actionText}「${planName}」`;
  if (detail) msg += ` ${detail}`;
  await sendMsg(msg);
}

// 阶段3: 验证结果后回复「执行完成」或「执行失败」
async function reportResult(chatId, ok, action, planName, detail, errMsg) {
  const actionMap = { pause: '暂停', stop: '关停', resume: '恢复', adjust_budget: '调整预算', reject: '拒绝' };
  const actionText = actionMap[action] || action;
  if (ok) {
    let msg = `✅ 执行完成: ${actionText}「${planName}」`;
    if (detail) msg += ` ${detail}`;
    await sendMsg(msg);
  } else {
    let msg = `❌ 执行失败: ${actionText}「${planName}」`;
    if (errMsg) msg += ` — ${errMsg}`;
    await sendMsg(msg);
  }
}

// ====== 命令解析 ======
function parseCommand(msg) {
  const text = msgText(msg);
  if (!text) return null;

  const rule = CMD_RULES.find(r => r.re.test(text));
  if (!rule) return null;

  let amount = null;
  if (rule.needAmount) {
    const m = text.match(/(\d{3,}(?:\.\d{1,2})?)/g);
    if (m) amount = parseFloat(m[m.length - 1]);
  }

  const planName = extractPlanName(text, rule.id, amount);
  return { cmd: rule.id, planName, amount, raw: text.slice(0, 200) };
}

function extractPlanName(text, cmd, amount) {
  // 1) 引号包裹
  let m = text.match(/[「"'](.+?)[」"']/);
  if (m) return m[1].trim();

  // 2) "计划名：xxx" (keyword must be standalone, not inside plan name like A计划)
  m = text.match(/(?:^|\s)(?:计划名|计划|plan|名|名字)[：:\s]+([^\s「」"'，,。]+)/i);
  if (m) return m[1].trim();

  // 3) 去掉命令前缀，再去掉末尾金额（如有），剩余为计划名
  const rule = CMD_RULES.find(r => r.id === cmd);
  let tail = text.replace(rule.re, '').trim();

  if (cmd === 'adjust_budget' && amount !== null) {
    // 按空格切分，移除最后一个数字 token（>= 3 位），避免排序
    const words = tail.split(/\s+/);
    for (let i = words.length - 1; i >= 0; i--) {
      const n = parseFloat(words[i]);
      if (!isNaN(n) && n >= 100) { words.splice(i, 1); break; }
    }
    tail = words.join(' ').trim();
  }

  tail = tail.replace(/[，,。！!?？]+$/, '').trim();
  if (tail && !/^(状态|status|队列|queue|帮助|help|\?)$/i.test(tail)) return tail;
  return null;
}

// ====== 队列 / 历史 ======
// loadQueue / saveQueue 已在文件顶部定义（入队模块）

function recordHistoryResponse(planName, response) {
  try {
    const h = loadSuggestionHistory();
    const t = [...h.suggestions].reverse().find(s =>
      !s.response && (s.campaignName === planName
        || s.campaignName?.includes(planName)
        || planName?.includes(s.campaignName))
    );
    if (t) { t.response = response; t.responseTime = new Date().toISOString(); recalcSummary(h); saveSuggestionHistory(h); return t.id; }
  } catch (e) { console.error('[history]', e.message); }
  return null;
}

function findQueued(planName) {
  const q = loadQueue();
  const i = q.actions?.findIndex(a => a.planName === planName
    || a.planName?.includes(planName)
    || planName?.includes(a.planName));
  return i >= 0 ? { idx: i, action: q.actions[i], queue: q } : null;
}

function removeQueued(idx) {
  const q = loadQueue();
  if (idx >= 0 && idx < (q.actions?.length || 0)) { q.actions.splice(idx, 1); saveQueue(q); }
}

// ====== [v1.1 D2] Pending 表（待确认操作） ======

function loadPending() {
  try { return JSON.parse(fs.readFileSync(ACTION_PENDING_FILE, 'utf-8')); } catch { return { pending: [] }; }
}
function savePending(data) { fs.writeFileSync(ACTION_PENDING_FILE, JSON.stringify(data, null, 2), 'utf-8'); }

function addPending(action, chatId, meta = {}) {
  initPendingFile();
  const data = loadPending();
  data.pending.push({
    tempId: crypto.randomUUID(),
    action: { planName: action.planName, type: action.type, amount: action.amount || null },
    chatId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    ...meta,
  });
  savePending(data);
}

// ====== [v1.1 D2] 当日重复指令检测 ======

function checkDuplicateToday(action) {
  try {
    initPendingFile();
    if (!fs.existsSync(ACTION_AUDIT_FILE)) return null;
    const today = new Date().toISOString().slice(0, 10);
    const lines = fs.readFileSync(ACTION_AUDIT_FILE, 'utf-8').split('\n').filter(Boolean);
    const duplicates = lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(r => r &&
        r.time?.startsWith(today) &&
        r.planName === action.planName &&
        r.actionType === action.type &&
        r.result?.ok === true
      );
    return duplicates.length > 0 ? duplicates : null;
  } catch { return null; }
}

// ====== [v1.1 D2+D5] 命令审核（预检查 + 重复检测 + 入队） ======

async function precheckAction(action) {
  try {
    const { createClient } = await import('./oceanengine-api-client.mjs');
    const client = await createClient({ useCache: true });
    const resp = await client.request(
      'https://ad.oceanengine.com/ad/api/promotion/projects/list?aadvid=1842681352509635',
      { method: 'POST', body: JSON.stringify({ limit: 50, page: 1, project_status: [-1], isSophonx: 1, need_trans_toLocal: true }) }
    );
    const projects = resp?.data?.data?.projects || [];
    const target = projects.find(c => c.project_name?.includes(action.planName));
    if (!target) return { ok: false, reason: '未找到计划 ' + action.planName };
    if (action.type === 'pause' && target.project_status_name !== '启用')
      return { ok: false, reason: `计划已处于「${target.project_status_name}」状态，无需重复暂停` };
    if (action.type === 'resume' && target.project_status_name === '启用')
      return { ok: false, reason: '计划已在投放中，无需重复恢复' };
    return { ok: true, target };
  } catch (e) { return { ok: false, reason: '预检查失败: ' + e.message }; }
}

async function acknowledgeStart(chatId, action, typeText) {
  // 1. 预检查
  const precheck = await precheckAction(action);
  if (!precheck.ok) {
    await sendMsg(chatId, '⚠️ ' + precheck.reason);
    return null;
  }

  // 2. 检测当日重复指令
  const duplicates = checkDuplicateToday(action);
  if (duplicates) {
    const count = duplicates.length;
    const last = duplicates[duplicates.length - 1];
    const lastTime = (last.time || '').slice(11, 19) || '未知';
    addPending(action, chatId, { isDuplicate: true, lastCount: count, lastTime });
    await sendMsg(chatId,
      '🟡 当日已对「' + action.planName + '」执行过 ' + count + ' 次' + typeText + '操作\n' +
      '   最近一次：' + lastTime + '\n' +
      '   确认要再次执行吗？\n' +
      '   回复"执行"确认 · 回复"拒绝"取消'
    );
    return { status: 'pending_confirm', isDuplicate: true };
  }

  // 3. 正常入队
  const queueLen = await enqueue(action);
  await sendMsg(chatId,
    '🔵 ' + typeText + '「' + action.planName + '」\n' +
    '   已入队 #' + queueLen + ' · 等待 worker 执行'
  );
  return { status: 'queued', position: queueLen };
}

// ====== [v1.1 D2] Pending 超时扫描（30s） ======

async function scanPending() {
  const data = loadPending();
  if (!data.pending.length) return;

  const now = new Date();
  const remaining = [];

  for (const item of data.pending) {
    if (new Date(item.expiresAt) < now) {
      await sendMsg(item.chatId,
        '⏰ 操作已超时取消\n' +
        '   「' + item.action.planName + '」确认超时（3分钟）\n' +
        '   如需执行请重新发送指令'
      );
    } else {
      remaining.push(item);
    }
  }

  if (remaining.length !== data.pending.length) {
    data.pending = remaining;
    savePending(data);
  }
}

// 命令分发用操作中文名
const ACTION_TEXT = { pause: '暂停', stop: '关停', resume: '恢复', adjust_budget: '加预算', reject: '拒绝', execute: '执行' };

// ====== 命令分发（入队模式：确认 → 入队 → 报告排队结果） ======
// 队列模式下，listener 只负责入队；实际执行由 action-queue-worker 完成。
// L3 二次输入确认：在 cdp-action 内的 confirmPopupIfAny 完成（飞书端的 acknowledgeStart 已是 L1 确认）。

async function dispatch(cmd, sender, chatId) {
  if (!chatId) chatId = MONITOR_CHAT_ID;
  const { cmd: type, planName, amount } = cmd;
  const by = sender?.name || sender || 'unknown';

  // --- info 命令：直接回复，不入队 ---
  if (type === 'info') {
    const q = loadQueue();
    const pending = q.actions?.filter(a => !a.failed).length || 0;
    const failed = q.actions?.filter(a => a.failed).length || 0;
    await sendMsg(chatId, `ℹ️ 监听中。队列 ${pending} 条待处理，${failed} 条失败。\n指令: 暂停/关停/加预算/恢复/拒绝/执行/状态\n(执行后由 worker 串行处理)`);
    return;
  }

  // --- reject 命令：确认 → 移除队列 → 报告 ---
  if (type === 'reject') {
    const q = loadQueue();
    if (!q.actions?.length) { await sendMsg(chatId, 'ℹ️ 队列为空，无需拒绝'); return; }
    const f = planName ? findQueued(planName) : { idx: 0, action: q.actions[0], queue: q };
    if (!f) { await sendMsg(chatId, `⚠️ 未在队列中找到「${planName}」`); return; }
    const rejectedPlan = f.action.planName;
    await acknowledgeStart(chatId, 'reject', rejectedPlan, '移除队列');
    f.queue.actions.splice(f.idx, 1); saveQueue(f.queue);
    recordHistoryResponse(rejectedPlan, 'reject');
    await reportResult(chatId, true, 'reject', rejectedPlan, '已从队列移除');
    return;
  }

  // --- 暂停/关停/恢复 → 入队 ---
  if (['pause', 'stop', 'resume'].includes(type)) {
    if (!planName) {
      const usage = type === 'pause' ? '暂停 「计划名」' : type === 'stop' ? '关停 「计划名」' : '恢复 「计划名」';
      await sendMsg(chatId, `⚠️ 未指定计划名。用法: ${usage}`);
      return;
    }
    const action = { type, planName, source: 'feishu', by };
    await acknowledgeStart(chatId, action, ACTION_TEXT[type] || type);
    return;
  }

  // --- 加预算 → 入队 ---
  if (type === 'adjust_budget') {
    if (!planName || !amount || amount <= 0) {
      await sendMsg(chatId, '⚠️ 未指定计划名或金额。用法: 加预算 「计划名」 8000');
      return;
    }
    const action = { type, planName, amount, source: 'feishu', by };
    await acknowledgeStart(chatId, action, '加预算');
    return;
  }

  // --- 执行（采纳队列中的建议，无计划名取队首） ---
  // 队列模式下，「执行」等价于：标记队首建议为 accepted（已采纳），等待 worker 自动处理
  if (type === 'execute') {
    const q = loadQueue();
    if (!planName && !q.actions?.length) {
      await sendMsg(chatId, '⚠️ 未指定计划名，且队列为空。\n用法: 执行（后跟计划名）/ 暂停 计划名 / 关停 计划名');
      return;
    }

    const f = planName ? findQueued(planName) : { idx: 0, action: q.actions[0], queue: q };
    if (!f) { await sendMsg(chatId, `⚠️ 队列中未找到「${planName}」`); return; }

    const act = f.action.type || 'pause';
    const execPlan = f.action.planName;
    const actType = (act === 'adjust_budget' || act === 'budget') ? 'adjust_budget' : act;
    const actDetail = actType === 'adjust_budget' ? `→ ${f.action.amount || amount}` : '';

    await acknowledgeStart(chatId, actType, execPlan, `${actDetail} 已采纳，等待 worker 执行`);
    // 标记为已采纳（不立即出队，由 worker 完成后出队）
    f.action.accepted = true;
    f.action.acceptedAt = new Date().toISOString();
    f.queue.actions[f.idx] = f.action;
    saveQueue(f.queue);
    recordHistoryResponse(execPlan, 'accept');

    await reportResult(chatId, true, actType, execPlan, '已采纳，等待 worker 执行');
    return;
  }

  await sendMsg(chatId, `ℹ️ 无法识别指令: ${cmd.raw}`);
}

// ====== AI对话 ======

async function getAccountContext() {
  try {
    const dataDir = path.join(__dirname, 'monitor-data');
    const files = fs.readdirSync(dataDir).filter(f => f.startsWith('5m-') && f.endsWith('.json')).sort().reverse();
    if (!files.length) return null;
    const latest = JSON.parse(fs.readFileSync(path.join(dataDir, files[0]), 'utf-8'));
    return {
      time: latest.time,
      totalSpend: Math.round(latest.accountSpend || 0),
      budget: Math.round(latest.accountBudget || 0),
      pct: Math.round((latest.accountSpend / (latest.accountBudget || 1)) * 100),
      conversions: latest.totalConv || 0,
      activeCount: latest.activeCount || 0,
      spendingCount: latest.spendingCount || 0,
      balance: Math.round(latest.accountBalance || 0),
      balanceDays: latest.accountSpend ? Math.round(latest.accountBalance / (latest.accountSpend / Math.max(latest._elapsedHours || 1, 1))) : '?',
    };
  } catch { return null; }
}

// 计划列表缓存（5分钟过期，避免频繁调 API）
let campaignCache = null;
async function getCampaignList() {
  const now = Date.now();
  if (campaignCache && (now - campaignCache.time) < 300000) return campaignCache.data;

  try {
    const { createClient } = await import('./oceanengine-api-client.mjs');
    const client = await createClient({ useCache: true });
    const resp = await client.request(
      'https://ad.oceanengine.com/ad/api/promotion/projects/list?aadvid=1842681352509635',
      { method: 'POST', body: JSON.stringify({ limit: 50, page: 1, project_status: [-1], isSophonx: 1, need_trans_toLocal: true }) }
    );
    const projects = resp?.data?.data?.projects || [];
    const list = projects.map(p => ({
      name: p.project_name || '',
      status: p.project_status_name || '',
      budget: p.campaign_budget || 0,
      bid: p.project_deep_cpa_bid || 0,
    }));
    campaignCache = { time: now, data: list };
    return list;
  } catch (e) {
    console.error('[campaign]', e.message);
    return campaignCache?.data || [];
  }
}

async function callAI(userMessage) {
  const ctx = await getAccountContext();
  let dataBlock = '';
  if (ctx) dataBlock = `消耗¥${ctx.totalSpend}/${ctx.budget}(${ctx.pct}%) 转化${ctx.conversions}次 投放中${ctx.spendingCount}条`;

  const camps = await getCampaignList();
  let campBlock = '';
  if (camps.length) {
    const active = camps.filter(c => c.status === '启用' || c.status === '投放中');
    campBlock = ' 计划: ' + active.map(c => c.name+'(¥'+c.budget+')').join(' ');
  }

  const prompt = `账户:极狐-区域福利号-直播 日预算¥60000。${dataBlock}。${campBlock}。根据以上信息回答: ${userMessage}`;

  // 写入 .bat 文件，通过 cmd 管道执行（绕过命令行长度限制）
  const { tmpdir } = await import('node:os');
  const tmpDir = path.join(tmpdir(), 'oec-ai');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const txtFile = path.join(tmpDir, 'prompt.txt');
  const batFile = path.join(tmpDir, 'run.bat');
  const outFile = path.join(tmpDir, 'output.txt');
  fs.writeFileSync(txtFile, prompt, 'utf-8');
  fs.writeFileSync(batFile, `@echo off\r\ntype "${txtFile}" | codebuddy -p -y`, 'utf-8');

  // 写 prompt 到文件，bat 脚本执行 codebuddy 并捕获输出到文件
  fs.writeFileSync(batFile, `@echo off\r\ntype "${txtFile}" | codebuddy -p -y > "${outFile}" 2>&1\r\nexit /b 0`, 'utf-8');

  return new Promise((resolve) => {
    try {
      // 不设 timeout — 让 codebuddy 自然完成
      const result = spawnSync('cmd', ['/c', batFile], {
        cwd: __dirname, windowsHide: true,
        encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024,
      });
      // 读输出文件
      let out = '';
      try { out = fs.readFileSync(outFile, 'utf-8').trim(); } catch {}
      if (result.error) {
        console.error('[AI] spawnSync error:', result.error.message);
      }
      if (!out) {
        console.error('[AI] empty output, exit:', result.status, 'pid:', result.pid);
      }
      resolve(out || null);
    } catch (e) {
      console.error('[AI] catch:', e.message);
      resolve(null);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    }
  });
}

async function handleAtMention(text, chatId) {
  const cleaned = cleanAtText(text);
  console.log("[listener] @ in " + (CHAT_NAMES[chatId]||chatId) + ": " + cleaned);
  if (!cleaned) {
    await sendMsg(chatId,
      '我在。\n\n' +
      '可查询数据: @小七 今天消耗多少 / 当前告警 / 余额\n' +
      '可执行操作: 暂停/关停/恢复/加预算 「计划名」\n' +
      '查看帮助: 状态 / 帮助');
    return;
  }
  // 直接回复，不再发送 "收到，思考中..."
  const reply = await callAI(cleaned);
  if (reply) { await sendMsg(chatId, reply); }
  else { await sendMsg(chatId, "抱歉，暂时无法处理，请稍后再试。状态 查看帮助"); }
}

// ====== 主循环 ======

async function main() {
  console.log('[listener] dual-chat mon=' + MONITOR_CHAT_ID + ' anchor=' + ANCHOR_CHAT_ID);
  var states = {};
  for (var _i = 0; _i < CHAT_IDS.length; _i++) {
    var _cid = CHAT_IDS[_i];
    var st = loadState(_cid);
    if (!st.lastMsgId) {
      var ms = await fetchMessages(_cid, 50);
      if (ms.length > 0) { st.lastMsgId = ms[0].message_id; saveState(st, _cid); console.log('[listener] ' + CHAT_NAMES[_cid] + ' skip ' + ms.length + ' msgs'); }
    }
    states[_cid] = st;
    console.log('[listener] ' + CHAT_NAMES[_cid] + ' lastMsgId=' + (st.lastMsgId || 'none'));
  }
  console.log('[listener] polling every 10s');
  // [v1.1 D2] 30s 扫描超时 pending 操作
  setInterval(scanPending, 30000);
  setInterval(async function() {
    for (var _j = 0; _j < CHAT_IDS.length; _j++) {
      var cid = CHAT_IDS[_j];
      try {
        var msgs = await fetchMessages(cid, 10);
        if (!msgs.length) continue;
        var _st = states[cid];
        var fresh = [];
        for (var _k = 0; _k < msgs.length; _k++) { if (msgs[_k].message_id === _st.lastMsgId) break; fresh.push(msgs[_k]); }
        if (!fresh.length) continue;
        fresh.reverse();
        for (var _m = 0; _m < fresh.length; _m++) {
          var m = fresh[_m];
          var t = msgText(m);
          if (isBotMsg(m, t)) { _st.lastMsgId = m.message_id; continue; }
          addReaction(m.message_id);  // 收到用户消息立即打 Get 表情
          var cmd = parseCommand(m);
          if (cmd) {
            console.log('[' + new Date().toLocaleTimeString() + '] [' + CHAT_NAMES[cid] + '] ' + (m.sender && m.sender.name || '?') + ' : ' + cmd.raw);
            try { await dispatch(cmd, (m.sender && m.sender.name) || 'unknown', cid); }
            catch(e) { console.error('[dispatch]', e.message); await sendMsg(cid, 'Error: ' + e.message); }
          } else if (isAtMention(m, t)) {
            console.log('[' + new Date().toLocaleTimeString() + '] [' + CHAT_NAMES[cid] + '] @' + (m.sender && m.sender.name || '?') + ' : ' + t.slice(0, 80));
            _st.lastMsgId = m.message_id; saveState(_st, cid); try { await handleAtMention(t, cid); }
            catch(e) { console.error('[at]', e.message); }
          }
        }
      } catch(e) { console.error('[poll-' + cid + ']', e.message); }
    }
  }, 10000);
}

main().catch(e => console.error('Fatal:', e));
