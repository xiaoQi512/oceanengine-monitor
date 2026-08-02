// src/services/feishu-listener-queue-store.mjs - listener 操作队列存储
import fs from 'node:fs';
import { ACTION_QUEUE_FILE } from '../utils/monitor-utils.mjs';

let queueWritePromise = Promise.resolve();
export function withQueueLock(fn) {
  const p = queueWritePromise.then(fn).finally(() => {});
  queueWritePromise = p;
  return p;
}

export function loadQueue({ queueFile = ACTION_QUEUE_FILE } = {}) {
  try { return JSON.parse(fs.readFileSync(queueFile, 'utf8')); } catch { return { actions: [] }; }
}

export function saveQueue(q, { queueFile = ACTION_QUEUE_FILE } = {}) {
  fs.writeFileSync(queueFile, JSON.stringify(q, null, 2));
}

export function enqueue(action, { queueFile = ACTION_QUEUE_FILE, now = () => new Date().toISOString() } = {}) {
  return withQueueLock(() => {
    const q = loadQueue({ queueFile });
    q.actions.push({
      time: now(),
      source: action.source || 'feishu',
      by: action.by || 'unknown',
      type: action.type,
      planName: action.planName,
      amount: action.amount ?? null,
      bid: action.bid ?? null,
    });
    saveQueue(q, { queueFile });
    return q.actions.length;
  });
}
