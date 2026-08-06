// src/services/http-routes/api-live-data.mjs - 直播状态 API 数据组装
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getSnapshotAt, cstToUtc } from '../../db/snapshot-db.mjs';

/**
 * 构造今日各班次数据明细
 * 数据源：
 *   1. shifts-{date}.json  → 班次时段/主播(label/anchorName)
 *   2. snapshots 表 (SQLite) → 每班次时段内消耗/线索
 *   3. shift_metrics.detail_json → 车型 carModel
 *   4. shift-push-lock.json → 已推送班次
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} DATA_DIR - monitor-data 目录
 * @param {string} DB_PATH - oceanengine.db 完整路径
 * @returns {Array<{start,end,anchor,carModel,spend,leads,cpl,conversions,privateMsg,pushed}>}
 */
export function buildShiftData(dateStr, DATA_DIR, DB_PATH) {
  const result = [];
  if (!dateStr || !DATA_DIR) return result;

  // 1. 读排班
  let shiftList = [];
  try {
    const cacheFile = path.join(DATA_DIR, `shifts-${dateStr}.json`);
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (Array.isArray(cached.shifts)) shiftList = cached.shifts;
    }
  } catch {}
  if (shiftList.length === 0) return result;

  // 2. 读推送锁
  const pushedLabels = new Set();
  try {
    const lockFile = path.join(DATA_DIR, 'shift-push-lock.json');
    if (fs.existsSync(lockFile)) {
      const lock = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
      if (Array.isArray(lock.shifts)) for (const lbl of lock.shifts) pushedLabels.add(lbl);
    }
  } catch {}

  // 3. 读 shift_metrics 取车型
  const carModelMap = new Map(); // key=label → carModel
  let db = null;
  try {
    if (DB_PATH && fs.existsSync(DB_PATH)) {
      db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
      const rows = db.prepare(
        `SELECT shift_label, detail_json FROM shift_metrics WHERE date = ?`
      ).all(dateStr);
      for (const r of rows) {
        if (!r.detail_json) continue;
        try {
          const detail = JSON.parse(r.detail_json);
          if (detail && detail.carModel) carModelMap.set(r.shift_label, detail.carModel);
        } catch {}
      }
    }
  } catch (e) {
    // ignore - carModel 走默认
  }

  // 4. 聚合每班次消耗/线索
  // 思路：对每个班次 [start, end) (CST 时间)，用 snapshot_time UTC（+8h 转 CST）
  //     对每个 plan：班次消耗 = 该 plan 在 [班次开始 CST, 班次结束 CST) 时间窗内 max(cost) - min(cost)
  //     leads 类似：max(leads) - min(leads)；再 SUM 所有 plan。
  // 简化:在班次时段内对每个 plan 单独取 (max - min)；0 消耗 plan 跳过。
  try {
    if (!db && DB_PATH && fs.existsSync(DB_PATH)) {
      db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    }
    if (db) {
      const planAggStmt = db.prepare(`
        SELECT campaign_id,
          MAX(cost) as max_cost,
          MIN(cost) as min_cost,
          MAX(leads) as max_leads,
          MIN(leads) as min_leads,
          MAX(msg_open) as max_msg_open,
          MIN(msg_open) as min_msg_open,
          (SELECT cpm FROM snapshots s2
           WHERE s2.campaign_id = s.campaign_id
             AND datetime(s2.snapshot_time, '+8 hours') >= @startCst
             AND datetime(s2.snapshot_time, '+8 hours') <  @endCst
           ORDER BY s2.snapshot_time DESC LIMIT 1) as latest_cpm,
          (SELECT ctr FROM snapshots s2
           WHERE s2.campaign_id = s.campaign_id
             AND datetime(s2.snapshot_time, '+8 hours') >= @startCst
             AND datetime(s2.snapshot_time, '+8 hours') <  @endCst
           ORDER BY s2.snapshot_time DESC LIMIT 1) as latest_ctr
        FROM snapshots s
        WHERE datetime(snapshot_time, '+8 hours') >= @startCst
          AND datetime(snapshot_time, '+8 hours') <  @endCst
        GROUP BY campaign_id
      `);

      const now = new Date();
      const nowTotal = now.getHours() * 60 + now.getMinutes();

      for (const s of shiftList) {
        const lbl = s.label || '';
        const [start, end] = lbl.split('-').map(x => x.trim());
        if (!start || !end) continue;
        const startCst = `${dateStr} ${start}:00`;
        const endCst = `${dateStr} ${end}:00`;
        const planRows = planAggStmt.all({ startCst, endCst });
        let spend = 0, leads = 0, openCount = 0, wCpmNum = 0, wCpmDen = 0, wCtrNum = 0, wCtrDen = 0;
        for (const p of planRows) {
          const dCost = Math.max(0, (p.max_cost || 0) - (p.min_cost || 0));
          const dLeads = Math.max(0, (p.max_leads || 0) - (p.min_leads || 0));
          const dOpen = Math.max(0, (p.max_msg_open || 0) - (p.min_msg_open || 0));
          spend += dCost;
          leads += dLeads;
          openCount += dOpen;
          if (dCost > 0) {
            if (p.latest_cpm != null && p.latest_cpm > 0) {
              wCpmNum += dCost * p.latest_cpm;
              wCpmDen += dCost;
            }
            if (p.latest_ctr != null && p.latest_ctr > 0) {
              wCtrNum += dCost * p.latest_ctr;
              wCtrDen += dCost;
            }
          }
        }
        const cpl = leads > 0 ? Number((spend / leads).toFixed(2)) : (spend > 0 ? Number(spend.toFixed(2)) : 0);
        const avgCpm = wCpmDen > 0 ? Number((wCpmNum / wCpmDen).toFixed(2)) : 0;
        const avgCtr = wCtrDen > 0 ? Number(((wCtrNum / wCtrDen) * 100).toFixed(2)) : 0;

        // 进度计算
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        const stTotal = sh * 60 + sm;
        const etTotal = eh * 60 + em;
        let progress = 0;
        if (nowTotal >= etTotal) progress = 100;
        else if (nowTotal > stTotal) progress = Math.round((nowTotal - stTotal) / (etTotal - stTotal) * 100);

        result.push({
          start, end,
          label: lbl,
          anchor: s.anchorName || '待定',
          carModel: carModelMap.get(lbl) || '贝塔S3',
          spend: Number(spend.toFixed(2)),
          leads: Math.round(leads),
          cpl,
          cpm: avgCpm,
          ctr: avgCtr,
          progress,
          conversions: Math.round(openCount),
          open: Math.round(openCount),
          pushed: pushedLabels.has(lbl),
        });
      }
    }
  } catch (e) {
    // DB 不可用时,仅返回基础结构(无 spend/leads)
    for (const s of shiftList) {
      const lbl = s.label || '';
      const [start, end] = lbl.split('-').map(x => x.trim());
      if (!start || !end) continue;
      result.push({
        start, end,
        label: lbl,
        anchor: s.anchorName || '待定',
        carModel: carModelMap.get(lbl) || '贝塔S3',
        spend: 0, leads: 0, cpl: 0, cpm: 0, ctr: 0, progress: 0, conversions: 0, open: 0,
        pushed: pushedLabels.has(lbl),
      });
    }
  } finally {
    if (db) { try { db.close(); } catch {} }
  }

  return result;
}

export function buildShifts(dateStr, DATA_DIR) {
  try {
    const cacheFile = path.join(DATA_DIR, `shifts-${dateStr}.json`);
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (Array.isArray(cached.shifts) && cached.shifts.length > 0) {
        return cached.shifts.map(s => {
          const parts = (s.label || '').split('-');
          if (parts.length !== 2) return null;
          return { start: parts[0].trim(), end: parts[1].trim() };
        }).filter(Boolean);
      }
    }
  } catch {}
  if (dateStr >= '2026-07-08' && dateStr <= '2026-07-10') {
    return [{start:'06:30',end:'08:30'},{start:'08:30',end:'10:30'},{start:'10:30',end:'12:30'},{start:'12:30',end:'14:30'},{start:'14:30',end:'16:30'},{start:'16:30',end:'18:30'},{start:'18:30',end:'20:30'},{start:'20:30',end:'22:30'},{start:'22:30',end:'23:30'}];
  }
  return [{start:'06:30',end:'08:30'},{start:'08:30',end:'10:30'},{start:'10:30',end:'12:30'},{start:'12:30',end:'14:30'},{start:'14:30',end:'16:30'},{start:'16:30',end:'18:30'},{start:'18:30',end:'20:30'},{start:'20:30',end:'23:30'}];
}

export function buildAnchors(dateStr, DATA_DIR) {
  try {
    const cacheFile = path.join(DATA_DIR, `shifts-${dateStr}.json`);
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (Array.isArray(cached.shifts)) return cached.shifts.map(s => s.anchorName || '待定');
    }
  } catch {}
  return [];
}

export function buildLivePayload({ sessions, anchors, snap, shiftData: shiftDataParam, DATA_DIR, nowIso = new Date().toISOString(), sessionAccount = null }) {
  const hm = new Date(nowIso).getHours() * 60 + new Date(nowIso).getMinutes();
  let shifts = [];
  let isLive = false;
  let currentAnchor = '';
  if (sessions && anchors.length > 0) {
    shifts = sessions.map((s, i) => {
      const [sh, sm] = s.start.split(':').map(Number);
      const [eh, em] = s.end.split(':').map(Number);
      const smin = sh * 60 + sm, emin = eh * 60 + em;
      let status = 'upcoming';
      if (hm >= emin) status = 'past';
      else if (hm >= smin) { status = 'live'; isLive = true; currentAnchor = anchors[i] || ''; }
      return { start: s.start, end: s.end, anchor: anchors[i] || '待定', status };
    });
  }
  // 优先使用调用方传入的 shiftData；否则尝试从 snap 透传（向后兼容旧 snap.shifts 字段）
  const shiftData = shiftDataParam || ((snap && snap.shifts) ? snap.shifts : []);
  const pushLog = [];
  try {
    const logFile = path.join(DATA_DIR, 'push-log.json');
    if (fs.existsSync(logFile)) pushLog.push(...(JSON.parse(fs.readFileSync(logFile, 'utf-8')).entries || []).slice(-10));
  } catch {}
  const accounts = [];
  if (snap && snap.accounts) {
    for (const a of snap.accounts) accounts.push({ id: a.id || a.name, name: a.name, spend: a.spend || 0, leads: a.leads || 0, cpl: a.cpl || (a.leads > 0 ? a.spend / a.leads : 0), activeCount: a.activeCount || 0 });
  }
  // 整场口径:若传入 sessionAccount(整场窗口账户聚合),则覆盖 KPI 消耗/线索/转化
  const sa = sessionAccount || {};
  const saSpend = Number(sa.spend || 0);
  const saLeads = Number(sa.leads || 0);
  const saConv = Number(sa.conversions || 0);
  const baseSpend = snap?.totalSpend ?? snap?.accountSpend ?? snap?.summarySpend ?? 0;
  const baseLeads = snap?.totalLeads ?? snap?.totalConv ?? 0;
  const baseConv = snap?.totalConversions ?? snap?.totalConv ?? 0;
  const kpi = snap ? {
    totalSpend: saSpend > 0 ? saSpend : baseSpend,
    liveSpend: snap.liveSpend ?? 0,
    videoSpend: snap.videoSpend ?? 0,
    totalLeads: saLeads > 0 ? saLeads : baseLeads,
    totalConversions: saConv > 0 ? saConv : baseConv,
    avgCpl: snap.avgCpl ?? ((saSpend > 0 ? saSpend : baseSpend) > 0 && (saConv > 0 ? saConv : baseConv) > 0
      ? (saSpend > 0 ? saSpend : baseSpend) / (saConv > 0 ? saConv : baseConv)
      : 0),
    liveCpl: snap.liveCpl ?? 0,
    videoCpl: snap.videoCpl ?? 0,
    privateMsg: snap.privateMsg ?? 0,
    dailyBudget: snap.dailyBudget ?? snap.accountBudget ?? 45000,
    aiRegionsSpend: snap.aiRegionsSpend ?? 0,
  } : {};
  return { isLive, currentAnchor, shifts, shiftData, pushLog, accounts, kpi, updatedAt: nowIso };
}
