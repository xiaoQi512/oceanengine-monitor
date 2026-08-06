// src/db/v2/compat-writer.mjs - v2 DAL 兼容旧 writer 接口
// 目标：在正式迁移前，让 v2 写入层可被旧调用方直接替换。
import { connect, closeDB } from './dal.mjs';

function num(v) {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function normalizeTime(input) {
  if (!input) return null;
  const s = String(input).replace(/\.json$/, '');
  const fileMatch = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/);
  if (fileMatch) return `${fileMatch[1]}T${fileMatch[2]}:${fileMatch[3]}:${fileMatch[4]}`;
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  return isoMatch ? isoMatch[1] : null;
}

function collectCampaigns(data) {
  const seen = new Set();
  return [
    ...(data.allSpending || []),
    ...(data.active || []),
    ...(data.campaigns || []),
  ].filter(c => {
    if (!c.id || seen.has(String(c.id))) return false;
    seen.add(String(c.id));
    // 仅写 cost > 0 或 leads > 0 的计划：让 5min/15min snapshots 与 trend 口径一致
    // 0 消耗的"待启动"计划在 trend 上没意义，反而会拉高 activeCount 误导 K3 行
    if (Number(c.spend || 0) <= 0 && Number(c.leads || 0) <= 0) return false;
    return true;
  });
}

export function insertSnapshot(data, snapshotTime) {
  const api = connect();
  let st = snapshotTime
    ? normalizeTime(snapshotTime)
    : normalizeTime(data?.time) || new Date().toISOString().replace(/\.\d+Z$/, '');
  if (!st) st = new Date().toISOString().replace(/\.\d+Z$/, '');

  const campaigns = collectCampaigns(data);
  if (campaigns.length === 0) {
    return { ok: true, rows: 0, snapshot_time: st, note: 'no_campaigns' };
  }

  const snapshots = [];
  const deleteExisting = api.raw.prepare('DELETE FROM snapshots WHERE campaign_id = ? AND snapshot_time = ?');
  for (const c of campaigns) {
    const budget = parseFloat(String(c.budget || '0').replace(/,/g, '')) || 0;
    const bid = parseFloat(String(c.bid || '').replace(/[^\d.]/g, '')) || null;
    api.campaigns.upsert({
      campaign_id: String(c.id),
      name: c.name || '',
      status: c.rawStatus || c.status || '',
      daily_budget: budget,
      bid,
    });
    deleteExisting.run(String(c.id), st);
    snapshots.push({
      snapshot_time: st,
      snapshot_cst: '',
      campaign_id: String(c.id),
      cost: num(c.spend),
      leads: num(c.leads),
      conversions: num(c.conversions),
      msg_open: num(c.privateMsgOpen),
      msg_lead: num(c.privateMsgRetain),
      form_submit: num(c.formSubmit),
      ctr: num(c.ctr),
      cpm: num(c.cpm),
      cvr: num(c.cvr),
      views: num(c.liveViews),
      views_1min: num(c.liveOver1Min),
      comments: num(c.liveComments),
      source_type: data.sourceType || '15min',
      status: c.status || c.rawStatus || null,
      page_summary_json: data.summary ? JSON.stringify(data.summary) : null,
      raw_json: JSON.stringify(c),
    });
  }

  api.snapshots.insert(snapshots);
  return { ok: true, rows: snapshots.length, snapshot_time: st };
}

export function verifyConsistency(jsonData, snapshotTime) {
  const api = connect();
  const st = normalizeTime(snapshotTime) || snapshotTime;
  const campaigns = collectCampaigns(jsonData);
  const row = api.raw.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE snapshot_time = ?').get(st);
  const dbCount = row?.n || 0;
  if (dbCount !== campaigns.length) {
    return { ok: false, warn: `row_count_mismatch: json=${campaigns.length} db=${dbCount}` };
  }
  const jsonCost = campaigns.reduce((s, c) => s + num(c.spend), 0);
  const costRow = api.raw.prepare('SELECT COALESCE(SUM(cost), 0) AS s FROM snapshots WHERE snapshot_time = ?').get(st);
  const dbCost = costRow?.s || 0;
  if (jsonCost === 0 && dbCost === 0) return { ok: true, deviation: 0 };
  const deviation = Math.abs(jsonCost - dbCost) / Math.max(jsonCost, 1);
  return deviation <= 0.01
    ? { ok: true, deviation }
    : { ok: false, deviation, warn: `cost_deviation: json=${jsonCost} db=${dbCost}` };
}

export function insertAction(entry) {
  const api = connect();
  try {
    const result = api.raw.prepare(`
      INSERT INTO actions(action_time, action_type, campaign_id, before_value, after_value, source, status, executed_at)
      VALUES (@time, @type, @cid, @before, @after, @source, @status, @executed_at)
    `).run({
      time: entry.time || new Date().toISOString(),
      type: entry.actionType || '',
      cid: entry.projectId || entry.campaignId || '',
      before: entry.beforeValue ? JSON.stringify(entry.beforeValue) : null,
      after: entry.afterValue ? JSON.stringify(entry.afterValue) : null,
      source: entry.source || 'unknown',
      status: entry.status || (entry.result?.ok ? 'success' : 'failed'),
      executed_at: entry.result?.ok ? (entry.time || new Date().toISOString()) : null,
    });
    return { ok: true, id: Number(result.lastInsertRowid) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function closeDb() {
  closeDB();
}

export default { insertSnapshot, verifyConsistency, insertAction, closeDb };
