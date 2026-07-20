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
import { findLarkCli, loadSuggestionHistory, saveSuggestionHistory, recalcSummary, DATA_DIR, CHROME_USER_DATA_DIR, CHROME_PROFILE_DIRECTORY, findChromeExe } from './monitor-utils.mjs';
import { checkCDP } from './cdp-client.mjs';

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
    await acknowledgeStart(chatId, type, planName, '已入队，等待 worker 执行');

    const queueLen = await enqueue({ type, planName, source: 'feishu', by });
    await reportResult(chatId, true, type, planName, `已入队 (位置 #${queueLen})，将由 worker 串行执行`);
    return;
  }

  // --- 加预算 → 入队 ---
  if (type === 'adjust_budget') {
    if (!planName || !amount || amount <= 0) {
      await sendMsg(chatId, '⚠️ 未指定计划名或金额。用法: 加预算 「计划名」 8000');
      return;
    }
    await acknowledgeStart(chatId, type, planName, `→ ${amount} 已入队`);

    const queueLen = await enqueue({ type, planName, amount, source: 'feishu', by });
    await reportResult(chatId, true, type, planName, `已入队 (位置 #${queueLen}，金额 ${amount})，将由 worker 串行执行`);
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


async function callAI(userMessage) {
  const systemPrompt = "你是小七，巨量引擎广告投放监控助手（账户：极狐-区域福利号-直播，日预算45000元）。你已在这个群聊中，直接自然回答问题，不要自我介绍。中文回复，不超过3句话。";
  const prompt = systemPrompt + "\n\n用户: " + userMessage + "\n小七:";
  const escaped = prompt.replace(/"/g, '\\"');
  return new Promise((resolve) => {
    exec(`codebuddy -p -y "${escaped}"`, {
      cwd: __dirname, windowsHide: true, timeout: 60000,
      shell: "C:\\Windows\\System32\\cmd.exe",
    }, (err, stdout, stderr) => {
      if (err) { console.error("[AI]", err.message); resolve(null); return; }
      const out = (stdout || "").trim();
      const noise = /^(我是小七|小七|您好|你好|我是)/;
      resolve(noise.test(out) ? out : out);
    });
  });
}

async function handleAtMention(text, chatId) {
  const cleaned = cleanAtText(text);
  console.log("[listener] @ in " + (CHAT_NAMES[chatId]||chatId) + ": " + cleaned);
  if (!cleaned) { await sendMsg(chatId, "我在，有什么事？"); return; }
  await sendMsg(chatId, "收到，思考中...");
  const reply = await callAI(cleaned);
  if (reply) { await sendMsg(chatId, reply); }
  else { await sendMsg(chatId, "抱歉，暂时无法处理，请稍后再试。"); }
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
