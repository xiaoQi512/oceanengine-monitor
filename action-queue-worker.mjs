// action-queue-worker.mjs — 串行队列 Worker
// 流程: 读 action-queue.json → 取队首 → cdp-action 执行 → 写审计 → 出队
// 串行锁: .lock 文件防止并发
// 失败重试 3 次后标记 failed 并跳过
//
// 用法:
//   node action-queue-worker.mjs              # 单次处理队首（推荐由 scheduler 调用）
//   node action-queue-worker.mjs --watch      # 持续轮询模式（每 15s 检查一次）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushText } from './feishu-push-guard.mjs';
import { findLarkCli } from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = path.join(__dirname, 'action-queue.json');
const LOCK_FILE = path.join(__dirname, 'action-queue.json.lock');
const AUDIT_LOG_FILE = path.join(__dirname, 'monitor-data', 'action-audit.jsonl');

const MAX_RETRIES = 3;
const RETRY_INTERVAL_MS = 5000;
const WATCH_INTERVAL_MS = 15000;

// ====== 动态 import cdp-action（避免空队列时强依赖 ws 等浏览器依赖） ======
let _cdpAction = null;
async function getCdpAction() {
  if (!_cdpAction) {
    _cdpAction = await import('./cdp-action.mjs');
  }
  return _cdpAction;
}

// ====== 串行锁 ======

function acquireLock() {
  try {
    // O_EXCL 原子创建：若已存在则抛错
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') {
      // 检查锁是否过期（>10分钟视为僵死）
      try {
        const stat = fs.statSync(LOCK_FILE);
        if (Date.now() - stat.mtimeMs > 10 * 60 * 1000) {
          console.warn('[worker] 检测到僵死锁，强制接管');
          fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, time: new Date().toISOString(), forced: true }));
          return true;
        }
      } catch {}
      return false;
    }
    throw e;
  }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

// ====== 队列读写 ======

function loadQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  } catch {
    return { actions: [] };
  }
}

function saveQueue(q) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2));
}

// ====== 审计日志 ======

// [v1.1 D1/D7] 唯一审计写入点（cdp-action 的 writeAuditLog 已废弃）
// source: auto/manual/dashboard/feishu
// method: http_api/cdp/none
const VALID_SOURCES = ['auto', 'manual', 'dashboard', 'feishu'];
function writeAudit(entry) {
  try {
    if (!fs.existsSync(path.dirname(AUDIT_LOG_FILE))) {
      fs.mkdirSync(path.dirname(AUDIT_LOG_FILE), { recursive: true });
    }
    const record = {
      time: entry.time || new Date().toISOString(),
      traceRef: entry.traceRef || '',
      actionType: entry.actionType || '',
      planName: entry.planName || '',
      projectId: entry.projectId || '',
      source: VALID_SOURCES.includes(entry.source) ? entry.source : 'unknown',
      beforeValue: entry.beforeValue ?? null,
      afterValue: entry.afterValue ?? null,
      result: {
        ok: entry.result?.ok ?? false,
        method: entry.result?.method || 'none',
        attempts: entry.result?.attempts || 0,
        error: entry.result?.error || null,
      },
      workerPid: process.pid,
    };
    fs.appendFileSync(AUDIT_LOG_FILE, JSON.stringify(record) + '\n');
  } catch (e) {
    console.warn('[worker] 审计写入失败:', e.message);
  }
}

// ====== 飞书反馈（小七端闭环）======
async function reportToFeishu(action, result, planName) {
  try {
    const larkCli = findLarkCli();
    if (!larkCli) { console.warn('[worker] 未找到 lark-cli，跳过飞书反馈'); return; }
    const actionText = { pause: '暂停', stop: '关停', resume: '恢复', adjust_budget: '加预算', adjust_bid: '改出价' }[action.type] || action.type;
    let msg;
    if (result?.ok) {
      const extra = result.alreadyDone ? '（已是目标状态）' : '';
      msg = `✅ ${actionText}「${planName}」完成${extra}\n来源: ${action.source || '手动'}`;
    } else {
      msg = `❌ ${actionText}「${planName}」失败\n原因: ${result?.err || '未知'}\n来源: ${action.source || '手动'}`;
    }
    await pushText(larkCli, msg);
    console.log(`[worker] 飞书反馈已发送: ${result?.ok ? '成功' : '失败'}`);
  } catch (e) {
    console.warn('[worker] 飞书反馈异常:', e.message);
  }
}
// ====== 单个 action 执行 ======

function mapActionType(type) {
  // 队列 action.type → cdp-action 函数
  // pause / stop / resume / adjust_budget / adjust_bid
  return {
    pause: 'toggle:pause',
    stop: 'toggle:stop',
    resume: 'toggle:resume',
    adjust_budget: 'adjust_budget',
    adjust_bid: 'adjust_bid',
  }[type] || type;
}

async function executeAction(action) {
  const { type, planName, amount, bid } = action;
  console.log(`[worker] 执行: ${type} plan="${planName}" amount=${amount ?? '-'} bid=${bid ?? '-'}`);

  const cdp = await getCdpAction();
  if (type === 'pause' || type === 'stop' || type === 'resume') {
    return await cdp.togglePlanStatus(planName, type);
  }
  if (type === 'adjust_budget') {
    return await cdp.adjustBudget(planName, amount);
  }
  if (type === 'adjust_bid') {
    return await cdp.adjustBid(planName, bid);
  }
  return { ok: false, err: `未知 action 类型: ${type}` };
}

// ====== 处理队首（带重试） ======

async function processHead() {
  const q = loadQueue();
  if (!q.actions?.length) return { processed: false, reason: 'empty' };

  const head = q.actions[0];
  const planName = head.planName || head.plan || '';
  const auditAction = mapActionType(head.type);

  let result = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    attempts = attempt;
    console.log(`[worker] 尝试 ${attempt}/${MAX_RETRIES}: ${head.type} "${planName}"`);
    try {
      result = await executeAction(head);
    } catch (e) {
      result = { ok: false, err: e.message };
    }
    if (result?.ok) break;

    if (attempt < MAX_RETRIES) {
      console.log(`[worker] 失败，${RETRY_INTERVAL_MS}ms 后重试: ${result?.err || '?'}`);
      await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
    }
  }

  // [v1.1 D1/D7] 写审计（唯一写入点，含扩展字段）
  writeAudit({
    traceRef: head.traceRef || '',
    actionType: auditAction,
    planName: planName,
    projectId: head.projectId || '',
    beforeValue: head.before || head.amount || head.bid || null,
    result: {
      ok: result?.ok ?? false,
      method: result?.method || 'http_api',
      attempts: attempts,
      error: result?.err || result?.error || null,
    },
    source: head.source || 'feishu',
  });

  // 出队 or 标记 failed
  const qLatest = loadQueue();
  if (qLatest.actions?.length) {
    if (result?.ok) {
      qLatest.actions.shift();
      console.log(`[worker] ✅ 完成: ${head.type} "${planName}"，已出队`);
    } else {
      // 标记 failed 并跳过（移到队尾 + failed 标记，避免阻塞后续）
      const failed = qLatest.actions.shift();
      failed.failed = true;
      failed.failedAt = new Date().toISOString();
      failed.lastError = result?.err || 'unknown';
      failed.attempts = attempts;
      qLatest.actions.push(failed);
      console.log(`[worker] ❌ 放弃: ${head.type} "${planName}"，标记 failed 并跳过`);
    }
    saveQueue(qLatest);
  }

  // 反馈到飞书（小七端闭环）
  await reportToFeishu(head, result, planName);

  return { processed: true, ok: !!result?.ok, result, attempts };
}

// ====== 入口 ======

async function runOnce() {
  if (!acquireLock()) {
    console.log('[worker] 另一进程持有锁，退出');
    return { processed: false, reason: 'locked' };
  }
  try {
    return await processHead();
  } finally {
    releaseLock();
  }
}

async function runWatch() {
  console.log(`[worker] watch 模式启动，每 ${WATCH_INTERVAL_MS / 1000}s 检查队列`);
  while (true) {
    try {
      const q = loadQueue();
      const pending = q.actions?.filter(a => !a.failed).length || 0;
      if (pending > 0) {
        console.log(`[worker] 队列待处理 ${pending} 条`);
        await runOnce();
      }
    } catch (e) {
      console.error('[worker] watch 异常:', e.message);
    }
    await new Promise(r => setTimeout(r, WATCH_INTERVAL_MS));
  }
}

// ====== CLI ======

const args = process.argv.slice(2);
if (args.includes('--watch')) {
  runWatch().catch(e => { console.error('Fatal:', e); process.exit(1); });
} else {
  runOnce().then(r => {
    console.log('[worker] 完成:', JSON.stringify(r).slice(0, 200));
    process.exit(r.processed ? 0 : 0);
  }).catch(e => { console.error('Fatal:', e); process.exit(1); });
}

export { processHead, runOnce, acquireLock, releaseLock };
