// src/services/feishu-listener-pending-store.mjs - listener 待办与查重存储
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ACTION_PENDING_FILE, ACTION_AUDIT_FILE, initPendingFile } from '../utils/monitor-utils.mjs';

export function loadPending({ pendingFile = ACTION_PENDING_FILE } = {}) {
  try { return JSON.parse(fs.readFileSync(pendingFile, 'utf-8')); } catch { return { pending: [] }; }
}

export function savePending(data, { pendingFile = ACTION_PENDING_FILE } = {}) {
  fs.writeFileSync(pendingFile, JSON.stringify(data, null, 2), 'utf-8');
}

export function addPending(
  action,
  chatId,
  meta = {},
  {
    pendingFile = ACTION_PENDING_FILE,
    init = initPendingFile,
    now = () => new Date(),
    randomUUID = crypto.randomUUID,
  } = {},
) {
  init();
  const data = loadPending({ pendingFile });
  const item = {
    tempId: randomUUID(),
    action: { planName: action.planName, type: action.type, amount: action.amount || null },
    chatId,
    createdAt: now().toISOString(),
    expiresAt: new Date(now().getTime() + 3 * 60 * 1000).toISOString(),
    ...meta,
  };
  data.pending.push(item);
  savePending(data, { pendingFile });
  return item;
}

export function findPending(
  chatId,
  planName,
  { pendingFile = ACTION_PENDING_FILE, init = initPendingFile } = {},
) {
  init();
  const data = loadPending({ pendingFile });
  let idx = -1;
  if (planName) idx = data.pending.findIndex(p => p.chatId === chatId && p.action?.planName === planName);
  if (idx === -1) {
    for (let i = data.pending.length - 1; i >= 0; i--) {
      if (data.pending[i].chatId === chatId) {
        idx = i;
        break;
      }
    }
  }
  return idx >= 0 ? { idx, item: data.pending[idx], data } : null;
}

export function removePending(data, idx, { pendingFile = ACTION_PENDING_FILE } = {}) {
  data.pending.splice(idx, 1);
  savePending(data, { pendingFile });
}

export function checkDuplicateToday(
  action,
  {
    auditFile = ACTION_AUDIT_FILE,
    init = initPendingFile,
    today = new Date().toISOString().slice(0, 10),
    readFileSync = fs.readFileSync,
    existsSync = fs.existsSync,
  } = {},
) {
  try {
    init();
    if (!existsSync(auditFile)) return null;
    const lines = readFileSync(auditFile, 'utf-8').split('\n').filter(Boolean);
    const duplicates = lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(r => r && r.time?.startsWith(today) && r.planName === action.planName && r.actionType === action.type && r.result?.ok === true);
    return duplicates.length > 0 ? duplicates : null;
  } catch {
    return null;
  }
}
