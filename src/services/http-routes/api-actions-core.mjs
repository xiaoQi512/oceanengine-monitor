// src/services/http-routes/api-actions-core.mjs - 操作队列/回滚核心逻辑
import fs from 'node:fs';

export const ACTION_TYPES = ['pause', 'stop', 'resume', 'adjust_budget', 'adjust_bid'];

export function isValidActionType(type) {
  return ACTION_TYPES.includes(type);
}

export function readJsonFile(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return parsed || fallback;
  } catch {
    return fallback;
  }
}

export function buildActionItem(data, sanitize, nowIso = new Date().toISOString()) {
  return {
    time: nowIso,
    source: sanitize(data.source || 'dashboard'),
    by: sanitize(data.by || 'api'),
    reason: sanitize(data.reason || data.by || data.source || ''),
    type: data.type,
    planName: data.planName || '',
    campaignId: sanitize(data.campaign_id || ''),
    amount: data.type === 'adjust_budget' ? Number(data.value) : null,
    bid: data.type === 'adjust_bid' ? Number(data.value) : null,
    status: 'pending',
  };
}

export function readAuditLines(file) {
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-500)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[audit-read]', e.message);
  }
  return lines;
}

export function findRollbackRecord(auditLines, data) {
  if (data.traceRef) return auditLines.find(r => r.traceRef === data.traceRef);
  if (data.time && data.planName) return auditLines.find(r => r.time === data.time && r.planName === data.planName);
  return [...auditLines].reverse().find(r =>
    r.result?.ok === true &&
    ACTION_TYPES.includes(r.actionType)
  );
}

export function buildRollbackAction(record) {
  const bv = record.beforeValue || {};
  switch (record.actionType) {
    case 'pause':
    case 'stop':
      return { ok: true, action: { type: 'resume', planName: record.planName } };
    case 'resume':
      return { ok: true, action: { type: 'pause', planName: record.planName } };
    case 'adjust_budget':
      if (bv.budget == null && typeof bv !== 'number') return { ok: false, error: '审计记录缺少 beforeValue.budget，无法回滚预算' };
      return { ok: true, action: { type: 'adjust_budget', planName: record.planName, amount: bv.budget ?? bv } };
    case 'adjust_bid':
      if (bv.bid == null && typeof bv !== 'number') return { ok: false, error: '审计记录缺少 beforeValue.bid，无法回滚出价' };
      return { ok: true, action: { type: 'adjust_bid', planName: record.planName, bid: bv.bid ?? bv } };
    default:
      return { ok: false, error: '不支持回滚的操作类型: ' + record.actionType };
  }
}

export function buildRollbackItem(action, record, by, nowIso = new Date().toISOString()) {
  return {
    time: nowIso,
    source: 'dashboard',
    by: by || 'dashboard-rollback',
    reason: `回滚 ${record.actionType} 操作`,
    type: action.type,
    planName: action.planName,
    campaignId: '',
    amount: action.amount ?? null,
    bid: action.bid ?? null,
    status: 'pending',
    rollbackOf: record.time,
  };
}

export function enqueueItem(file, item, withWriteLock) {
  return withWriteLock(() => {
    const q = readJsonFile(file, { actions: [] });
    if (!Array.isArray(q.actions)) q.actions = [];
    q.actions.push(item);
    fs.writeFileSync(file, JSON.stringify(q, null, 2));
  });
}
