// cloud-action-poller.mjs - 云端指令轮询执行 (20260915 小程序上架链路)
// 每 2 分钟拉取云托管 pending 指令 → 转换为本地 action-queue 格式入队 →
// 本地 runOnce 执行(API优先+CDP降级) → 结果回写云端
// 调度: PM2 pm2-cloud-action-poller, cron '*/2'
// .env 需要: CLOUDRUN_URL, CLOUDRUN_API_KEY

import { ACTION_QUEUE_FILE } from '../utils/monitor-utils.mjs';
import { runOnce } from '../services/action-worker-run.mjs';
import { loadQueue, saveQueue } from '../services/action-store.mjs';
import fs from 'node:fs';

const CLOUDRUN_URL = (process.env.CLOUDRUN_URL || '').replace(/\/+$/, '');
const CLOUDRUN_API_KEY = process.env.CLOUDRUN_API_KEY || '';

const TYPE_MAP = {
  pause: 'pause',
  enable: 'resume',          // 本地执行器: resume=启用
  update_budget: 'update_budget'
};

function log(...args) {
  console.log('[cloud-poller]', ...args);
}

async function fetchPending() {
  const res = await fetch(`${CLOUDRUN_URL}/actions/pending`, {
    headers: { 'X-API-Key': CLOUDRUN_API_KEY },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`pending HTTP ${res.status}`);
  const data = await res.json();
  return (data.actions || []);
}

async function reportResult(actionId, status, result) {
  try {
    const res = await fetch(`${CLOUDRUN_URL}/actions/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': CLOUDRUN_API_KEY },
      body: JSON.stringify({ action_id: actionId, status, result }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) log('回写结果失败 HTTP', res.status);
  } catch (e) {
    log('回写结果异常:', e.message);
  }
}

function enqueueCloudAction(cloud) {
  const q = loadQueue({ queueFile: ACTION_QUEUE_FILE });
  q.actions = q.actions || [];
  // 防重复: 同一云端指令不重复入队
  if (q.actions.some(a => a.cloudActionId === cloud.action_id)) return false;
  const local = {
    cloudActionId: cloud.action_id,
    type: TYPE_MAP[cloud.action] || cloud.action,
    planName: cloud.campaign_name || '',
    amount: cloud.params?.budget,
    bid: cloud.params?.bid,
    source: 'cloud',
    enqueuedAt: new Date().toISOString()
  };
  if (!local.planName) throw new Error('缺少 campaign_name, 无法定位计划');
  q.actions.push(local);
  saveQueue(q, { queueFile: ACTION_QUEUE_FILE });
  return true;
}

// 执行队头并返回 {processed, ok, result}; 锁竞争时重试
async function executeWithRetry(maxRetry = 3) {
  for (let i = 0; i < maxRetry; i++) {
    const r = await runOnce();
    if (r?.processed || r?.reason !== 'locked') return r;
    log(`锁被占用(${i + 1}/${maxRetry}), 5s 后重试`);
    await new Promise(res => setTimeout(res, 5000));
  }
  return { processed: false, reason: 'locked' };
}

// runOnce 处理的是队头; 云端指令入队后若前面还有积压, 需循环消化直到处理完我们的指令
async function executeUntil(cloudActionId, maxLoop = 10) {
  for (let i = 0; i < maxLoop; i++) {
    const r = await executeWithRetry();
    if (r?.reason === 'locked') return { processed: false, reason: 'locked' };
    if (!r?.processed) {
      // 队列空了? 检查我们的指令还在不在
      const q = loadQueue({ queueFile: ACTION_QUEUE_FILE });
      const mine = (q.actions || []).find(a => a.cloudActionId === cloudActionId);
      if (!mine) return { processed: true, ok: true, result: { ok: true, note: '由并行 worker 消化' } };
      if (mine.failed) return { processed: true, ok: false, result: { ok: false, error: mine.lastError } };
      // processed=false 且未锁定 → 队头不是 failed 但没执行? 等待重试
      await new Promise(res => setTimeout(res, 3000));
      continue;
    }
    // processed=true: 只处理了队头, 看我们的指令是否还在队列
    const q = loadQueue({ queueFile: ACTION_QUEUE_FILE });
    const mine = (q.actions || []).find(a => a.cloudActionId === cloudActionId);
    if (!mine) return { processed: true, ok: !!r.ok, result: r.result || { ok: !!r.ok } };
    if (mine.failed) return { processed: true, ok: false, result: { ok: false, error: mine.lastError } };
    // 我们的指令不是队头, 继续循环消化
  }
  return { processed: false, reason: 'loop-limit' };
}

async function main() {
  if (!CLOUDRUN_URL || !CLOUDRUN_API_KEY) {
    log('缺少 CLOUDRUN_URL / CLOUDRUN_API_KEY (.env), 跳过');
    process.exit(1);
  }
  let pending = [];
  try {
    pending = await fetchPending();
  } catch (e) {
    log('拉取指令失败:', e.message);
    process.exit(1);
  }
  if (!pending.length) {
    log('无待执行指令');
    return;
  }
  for (const cloud of pending) {
    try {
      const enqueued = enqueueCloudAction(cloud);
      if (!enqueued) {
        await reportResult(cloud.action_id, 'failed', { ok: false, error: 'duplicate' });
        continue;
      }
      log(`已入队: ${cloud.action} "${cloud.campaign_name}" (${cloud.action_id})`);
      const r = await executeUntil(cloud.action_id);
      if (r.processed) {
        await reportResult(cloud.action_id, r.ok ? 'done' : 'failed', r.result);
        log(`${r.ok ? '✅ done' : '❌ failed'}: ${cloud.action_id}`);
      } else {
        // 保持 claimed, 下轮由本地队列消化或人工处理; 标记失败避免悬挂
        await reportResult(cloud.action_id, 'failed', { ok: false, error: `execute: ${r.reason}` });
        log(`⏸ 执行未完成(${r.reason}): ${cloud.action_id}, 已回写 failed`);
      }
    } catch (e) {
      log(`指令处理异常 ${cloud.action_id}:`, e.message);
      await reportResult(cloud.action_id, 'failed', { ok: false, error: e.message });
    }
  }
}

main();
