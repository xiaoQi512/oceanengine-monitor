// src/services/action-store.mjs - action 队列与串行锁存储
import fs from 'node:fs';
import path from 'node:path';
import { ACTION_QUEUE_FILE, ACTION_LOCK_FILE, ACTION_AUDIT_FILE, DATA_DIR } from '../utils/monitor-utils.mjs';
import { dualInsertAction } from '../db/dual-write.mjs';

const VALID_SOURCES = ['auto', 'manual', 'dashboard', 'feishu'];

export function acquireLock({
  lockFile = ACTION_LOCK_FILE,
  now = Date.now(),
  pid = process.pid,
  staleMs = 10 * 60 * 1000,
} = {}) {
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ pid, time: new Date().toISOString() }), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') {
      try {
        const stat = fs.statSync(lockFile);
        if (now - stat.mtimeMs > staleMs) {
          console.warn('[worker] 检测到僵死锁，强制接管');
          fs.writeFileSync(lockFile, JSON.stringify({ pid, time: new Date().toISOString(), forced: true }));
          return true;
        }
      } catch {}
      return false;
    }
    throw e;
  }
}

export function releaseLock({ lockFile = ACTION_LOCK_FILE } = {}) {
  try { fs.unlinkSync(lockFile); } catch {}
}

export async function loadQueue({ queueFile = ACTION_QUEUE_FILE, retryDelayMs = 200 } = {}) {
  try {
    return JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  } catch {
    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    try {
      return JSON.parse(fs.readFileSync(queueFile, 'utf8'));
    } catch {
      console.warn('[worker] 队列文件读取失败，已返回空队列');
      return { actions: [] };
    }
  }
}

export function saveQueue(q, { queueFile = ACTION_QUEUE_FILE } = {}) {
  fs.writeFileSync(queueFile, JSON.stringify(q, null, 2));
}

export function getSnapshotBefore({ dataDir = DATA_DIR } = {}) {
  try {
    const files = fs.readdirSync(dataDir)
      .filter(f => f.startsWith('5m-') && f.endsWith('.json'))
      .sort();
    if (files.length === 0) return null;
    const latest = files[files.length - 1];
    const snap = JSON.parse(fs.readFileSync(path.join(dataDir, latest), 'utf-8'));
    return {
      accountSpend: Number(snap.accountSpend) || 0,
      totalConv: Number(snap.totalConv) || 0,
      time: snap.time || latest.replace(/^5m-/, '').replace(/\.json$/, '').replace(/-/g, (m, i) => i >= 10 ? ':' : '-'),
      file: latest,
    };
  } catch (e) {
    console.warn('[worker] 读快照失败:', e.message);
    return null;
  }
}

export function writeAudit(
  entry,
  {
    auditFile = ACTION_AUDIT_FILE,
    dataDir = DATA_DIR,
    insertAction = dualInsertAction,
    pid = process.pid,
  } = {},
) {
  try {
    if (!fs.existsSync(path.dirname(auditFile))) {
      fs.mkdirSync(path.dirname(auditFile), { recursive: true });
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
      snapshotBefore: getSnapshotBefore({ dataDir }),
      result: {
        ok: entry.result?.ok ?? false,
        method: entry.result?.method || 'none',
        attempts: entry.result?.attempts || 0,
        error: entry.result?.error || null,
      },
      workerPid: pid,
    };
    fs.appendFileSync(auditFile, JSON.stringify(record) + '\n');
    try {
      const r = insertAction(record);
      if (!r.ok) console.warn('[worker] DB actions 写入失败:', r.error);
    } catch (e) {
      console.warn('[worker] DB actions 异常:', e.message);
    }
  } catch (e) {
    console.warn('[worker] 审计写入失败:', e.message);
  }
}
