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
import { findLarkCli, ACTION_QUEUE_FILE, ACTION_LOCK_FILE, ACTION_AUDIT_FILE, ACCOUNT_ID } from './monitor-utils.mjs';
import { checkCDP } from './cdp-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// [v1.1 D4] 路径常量统一从 monitor-utils 导入（支持环境变量覆盖）
const QUEUE_FILE = ACTION_QUEUE_FILE;
const LOCK_FILE = ACTION_LOCK_FILE;
const AUDIT_LOG_FILE = ACTION_AUDIT_FILE;

const WATCH_INTERVAL_MS = 15000;

// [v1.1 P2-fix] 双路径重试：HTTP API 主方案（快）+ CDP 降级（慢）
const API_MAX_RETRIES = 3;
const API_RETRY_INTERVAL_MS = 2000;
const CDP_MAX_RETRIES = 2;
const CDP_RETRY_INTERVAL_MS = 5000;

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
// ====== 单个 action 执行（CDP 降级路径，仅在 HTTP API 失败时使用） ======

async function executeAction(action) {
  const { type, planName, amount, bid } = action;
  console.log(`[worker] CDP 执行: ${type} plan="${planName}" amount=${amount ?? '-'} bid=${bid ?? '-'}`);

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

// ====== [v1.1 P2-fix] HTTP API 主方案：优先通过 API 执行操作 ======
// 使用 projectId（from readPlanAfterValue）调 HTTP API，避免 CDP 文本搜索不可靠
async function tryHttpApi(head, projectId) {
  const { createClient, updateProjectStatus, updateProjectBudget, updateProjectBid } = await getApiClient();
  const client = await createClient({ useCache: true });

  const { type, planName, amount, bid } = head;
  console.log(`[worker] HTTP API 执行: ${type} plan="${planName}" projectId=${projectId}`);

  let result = null;
  switch (type) {
    case 'pause':
    case 'stop':
      result = await updateProjectStatus(client, { projectId, status: 'pause' });
      break;
    case 'resume':
      result = await updateProjectStatus(client, { projectId, status: 'enable' });
      break;
    case 'adjust_budget':
      result = await updateProjectBudget(client, { projectId, budget: amount });
      break;
    case 'adjust_bid':
      result = await updateProjectBid(client, { projectId, bid });
      break;
    default:
      return { ok: false, err: `HTTP API 不支持的 action: ${type}` };
  }
  result.method = 'http_api';
  return result;
}

// ====== [v1.1 D3] CDP 熔断：检查 Chrome CDP 是否可达 ======
// 顶部 import checkCDP，避免热路径动态 import
async function isChromeHealthy() {
  try {
    const status = await checkCDP();
    return status?.reachable === true;
  } catch (e) {
    console.warn('[worker] Chrome 健康检查失败:', e.message);
    return false;
  }
}

// ====== [v1.1 P2] 计划状态回读：操作前后调 API 读取实际状态 ======
// 用于审计日志 beforeValue/afterValue 字段，确保记录真实状态
let _apiClient = null;
async function getApiClient() {
  if (!_apiClient) _apiClient = await import('./oceanengine-api-client.mjs');
  return _apiClient;
}

// [v1.1 P2-fix] 加超时保护，避免 API 慢阻塞 worker 持锁
async function readPlanAfterValue(planName, timeoutMs = 10000) {
  try {
    const { createClient } = await getApiClient();
    const client = await createClient({ useCache: true });
    const result = await Promise.race([
      client.request(
        'https://ad.oceanengine.com/ad/api/promotion/projects/list?aadvid=' + ACCOUNT_ID,
        { method: 'POST', body: JSON.stringify({ limit: 50, page: 1, project_status: [-1], isSophonx: 1, need_trans_toLocal: true }) }
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('readPlanAfterValue timeout')), timeoutMs)),
    ]);
    const projects = result?.data?.data?.projects || [];
    const target = projects.find(c => c.project_name?.includes(planName));
    if (!target) return null;
    return {
      status: target.project_status_name || '',
      budget: target.campaign_budget ?? null,
      bid: target.project_deep_cpa_bid ?? null,
      projectId: target.project_id || '',
    };
  } catch (e) {
    console.warn('[worker] 计划状态回读失败:', e.message);
    return null;
  }
}

// ====== 处理队首（带重试 + CDP 熔断） ======

async function processHead() {
  const q = loadQueue();
  if (!q.actions?.length) return { processed: false, reason: 'empty' };

  // [v1.1 P1-fix] 跳过队首 failed 项（避免重复处理已放弃的操作）
  let skippedFailed = 0;
  while (q.actions.length && q.actions[0].failed) {
    q.actions.shift();
    skippedFailed++;
  }
  if (skippedFailed > 0) saveQueue(q);
  if (!q.actions.length) {
    return { processed: false, reason: 'all-failed-skipped' };
  }

  const head = q.actions[0];
  const planName = head.planName || head.plan || '';
  // [v1.1 D7] 审计 actionType 统一用原始 type（pause/stop/resume/adjust_budget/adjust_bid）
  // 便于 checkDuplicateToday 跨进程匹配，不再做 toggle: 前缀转换
  const auditAction = head.type || '';

  // [v1.1 P2-fix] 执行前回读 beforeValue，确保审计记录有真实操作前状态
  // 入队的 head.before 通常为空，这里主动调 API 读取
  const beforeValue = await readPlanAfterValue(planName);

  let result = null;
  let attempts = 0;
  let method = 'none';

  // [v1.1 P2-fix] 双路径执行：HTTP API 主方案 → CDP 降级
  // Phase 1: 尝试 HTTP API（需要 projectId，from readPlanAfterValue）
  const projectId = beforeValue?.projectId || head.projectId || '';
  if (projectId) {
    for (let attempt = 1; attempt <= API_MAX_RETRIES; attempt++) {
      attempts = attempt;
      console.log(`[worker] HTTP API 尝试 ${attempt}/${API_MAX_RETRIES}: ${head.type} "${planName}" projectId=${projectId}`);
      try {
        result = await tryHttpApi(head, projectId);
      } catch (e) {
        result = { ok: false, err: e.message };
      }
      if (result?.ok) {
        method = 'http_api';
        break;
      }
      if (attempt < API_MAX_RETRIES) {
        console.log(`[worker] HTTP API 失败，${API_RETRY_INTERVAL_MS}ms 后重试: ${result?.err || result?.error || '?'}`);
        await new Promise(r => setTimeout(r, API_RETRY_INTERVAL_MS));
      }
    }
  } else {
    console.log('[worker] 无 projectId，跳过 HTTP API，直接尝试 CDP');
  }

  // Phase 2: HTTP API 失败 → CDP 降级（需 Chrome 健康）
  if (!result?.ok) {
    console.log(`[worker] HTTP API ${projectId ? '全部失败' : '跳过'}，检查 CDP 降级可行性`);

    // [v1.1 D3] CDP 熔断：执行前检查 Chrome 是否可达
    const chromeOk = await isChromeHealthy();
    if (!chromeOk) {
      console.log('[worker] CDP 熔断: Chrome 不可达，拒绝操作并存审计');
      writeAudit({
        traceRef: head.traceRef || '',
        actionType: auditAction,
        planName: planName,
        projectId: projectId || beforeValue?.projectId || '',
        beforeValue,
        afterValue: null,
        result: { ok: false, method: 'none', attempts: attempts, error: 'HTTP_API_FAILED + CHROME_UNREACHABLE' },
        source: head.source || 'feishu',
      });
      // 出队标记 failed
      const qUp1 = loadQueue();
      if (qUp1.actions?.length) {
        const failed = qUp1.actions.shift();
        failed.failed = true;
        failed.failedAt = new Date().toISOString();
        failed.lastError = 'HTTP_API_FAILED + CHROME_UNREACHABLE';
        failed.attempts = 0;
        qUp1.actions.push(failed);
        saveQueue(qUp1);
      }
      await reportToFeishu(head, { ok: false, err: 'HTTP API 失败 + Chrome 不可达，已熔断跳过' }, planName);
      return { processed: true, ok: false, reason: 'CDP_UNREACHABLE' };
    }

    // CDP 降级执行
    console.log(`[worker] CDP 降级执行: ${head.type} "${planName}"`);
    for (let attempt = 1; attempt <= CDP_MAX_RETRIES; attempt++) {
      attempts++;
      console.log(`[worker] CDP 尝试 ${attempt}/${CDP_MAX_RETRIES}: ${head.type} "${planName}"`);
      try {
        result = await executeAction(head);
      } catch (e) {
        result = { ok: false, err: e.message };
      }
      if (result?.ok) {
        method = 'cdp';
        break;
      }
      if (attempt < CDP_MAX_RETRIES) {
        console.log(`[worker] CDP 失败，${CDP_RETRY_INTERVAL_MS}ms 后重试: ${result?.err || '?'}`);
        await new Promise(r => setTimeout(r, CDP_RETRY_INTERVAL_MS));
      }
    }
    if (!method) method = 'cdp-failed';
  }

  // [v1.1 D1/D7] 写审计（唯一写入点，含扩展字段）
  // [v1.1 P2] afterValue 回读：优先用 result 自带值，不足时调 API 回读实际状态
  let afterValue = null;
  if (result?.ok) {
    if (result.freshData) afterValue = result.freshData;
    else if (result.newBudget != null) afterValue = { budget: result.newBudget };
    else if (result.newBid != null) afterValue = { bid: result.newBid };
    else if (result.state) afterValue = result.state;

    // [v1.1 P2] result 缺乏可靠 afterValue 时，调 API 回读
    if (!afterValue) {
      console.log('[worker] afterValue 缺失，调 API 回读:', planName);
      afterValue = await readPlanAfterValue(planName);
    }
  }
  writeAudit({
    traceRef: head.traceRef || '',
    actionType: auditAction,
    planName: planName,
    projectId: beforeValue?.projectId || head.projectId || '',
    beforeValue,
    afterValue,
    result: {
      ok: result?.ok ?? false,
      method: result?.method || method || 'http_api',
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
