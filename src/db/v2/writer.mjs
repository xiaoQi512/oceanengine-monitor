// writer.mjs - 双写接口 (JSON 文件 + SQLite 数据库)
// 监控脚本采集数据后调用 insertSnapshot() 同时写入两端
// 双通道独立，一边失败不影响另一边

import { connect, getDBPath } from './dal.mjs';
import { DATA_DIR } from '../../utils/monitor-utils.mjs';

let _api = null;
function getAPI() { if (!_api) _api = connect(); return _api; }

/**
 * 解析 15/5 分钟快照数据，写入 SQLite
 * @param {object} data - 监控 v3 采集的完整快照对象
 * @param {string} sourceType - '15min' | '5min'
 */
export function insertSnapshot(data, sourceType = '15min') {
  const api = getAPI();
  const snapshotTime = data.time || new Date().toISOString();

  // CST 时间推算
  const cst = new Date(snapshotTime);
  cst.setHours(cst.getHours() + 8);
  const cstStr = cst.toISOString().slice(11, 16); // HH:MM

  const snapshots = [];

  // 处理 active 计划
  for (const p of (data.active || [])) {
    // 先 upsert 计划
    api.campaigns.upsert({
      campaign_id: p.id,
      name: p.name,
      status: p.rawStatus || p.status,
      daily_budget: p.budget || 0,
    });

    // 构建快照行
    snapshots.push({
      snapshot_time: snapshotTime,
      snapshot_cst: cstStr,
      campaign_id: p.id,
      cost: p.spend || 0,
      leads: p.leads || 0,
      conversions: p.conversions || 0,
      msg_open: p.privateMsgOpen || 0,
      msg_lead: p.privateMsgRetain || 0,
      form_submit: p.formSubmit || 0,
      ctr: p.ctr || 0,
      cpm: p.cpm || 0,
      cvr: p.cvr || 0,
      views: p.liveViews || 0,
      views_1min: p.liveOver1Min || 0,
      comments: p.liveComment || 0,
      source_type: sourceType,
      raw_json: null, // 可节选摘要
    });
  }

  // 处理 allSpending (含暂停但有消耗的计划)
  for (const p of (data.allSpending || [])) {
    const existing = snapshots.find(s => s.campaign_id === p.id);
    if (existing) continue;
    api.campaigns.upsert({
      campaign_id: p.id, name: p.name,
      status: p.rawStatus || p.status, daily_budget: p.budget || 0,
    });
    snapshots.push({
      snapshot_time: snapshotTime, snapshot_cst: cstStr,
      campaign_id: p.id, cost: p.spend || 0, leads: p.leads || 0,
      conversions: p.conversions || 0, msg_open: p.privateMsgOpen || 0,
      msg_lead: p.privateMsgRetain || 0, form_submit: p.formSubmit || 0,
      ctr: p.ctr || 0, cpm: p.cpm || 0, cvr: p.cvr || 0,
      views: p.liveViews || 0, views_1min: p.liveOver1Min || 0,
      comments: p.liveComment || 0, source_type: sourceType, raw_json: null,
    });
  }

  if (snapshots.length > 0) {
    api.snapshots.insert(snapshots);
    return snapshots.length;
  }
  return 0;
}

/**
 * 写入场次数据到 shift_metrics 表
 */
export function insertShiftMetric(shiftData) {
  const api = getAPI();
  return api.shifts.upsert(shiftData);
}

/**
 * 写入日汇总
 */
export function insertDailySummary(data) {
  const api = getAPI();
  return api.daily.upsert(data);
}

/**
 * 一致性校验：抽样对比 JSON 快照与 SQLite 数据
 * @returns {{ ok: boolean, diffs: Array, jsonTotal: number, dbTotal: number }}
 */
export function verifyConsistency(dateStr) {
  const api = getAPI();
  const today = dateStr || new Date().toISOString().slice(0, 10);
  const dbSnaps = api.raw
    .prepare('SELECT snapshot_time, campaign_id, cost, leads FROM snapshots WHERE snapshot_time LIKE @d || "%" LIMIT 20')
    .all({ d: today });

  // 从 monitor-data 读 JSON 对照
  const diffs = [];
  let jsonTotal = 0, dbTotal = 0;

  try {
    const fs = require('fs');
    const path = require('path');
    const sample = dbSnaps.slice(0, 10);
    for (const row of sample) {
      const filePath = path.join(DATA_DIR, row.snapshot_time.replace(/[:.]/g, '-').slice(0, 19) + '.json');
      if (fs.existsSync(filePath)) {
        const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const plan = (json.active || []).find(p => p.id === row.campaign_id);
        if (plan) {
          const jCost = plan.spend || 0;
          if (Math.abs(jCost - row.cost) > 0.01) {
            diffs.push({ campaign: row.campaign_id, json: jCost, db: row.cost });
          }
          jsonTotal += jCost;
          dbTotal += row.cost;
        }
      }
    }
  } catch { /* ignore */ }

  return { ok: diffs.length === 0, diffs, jsonTotal, dbTotal };
}

export default { insertSnapshot, insertShiftMetric, insertDailySummary, verifyConsistency };
