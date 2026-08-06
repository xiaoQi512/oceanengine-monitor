// src/services/session-window.mjs - 整场直播窗口解析
//
// 业务语义:
//   整场直播 = 从本场直播开播时刻起,到当前直播结束(或当前时刻)。
//   若相邻两日排班时间连续(前一日末班结束 == 当日首班开始,如 24:00 接 00:00),
//   则合并为同一场直播,起点向前回溯;直到某日排班不连续为止。
//   单场次 = 单个主播班次(如 05:30-07:30),是整场的子集。
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function getSessionSpendRows(DB_PATH, startCst, endCst) {
  if (!DB_PATH || !fs.existsSync(DB_PATH)) return null;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const startDay = String(startCst).slice(0, 10);
      const endDay = String(endCst).slice(0, 10);
      const days = [];
      let cur = startDay;
      while (cur <= endDay) {
        days.push(cur);
        cur = addDays(cur, 1);
      }
      const stmt = db.prepare(`
        SELECT s.campaign_id,
          MAX(s.cost) AS max_cost,
          MIN(s.cost) AS min_cost,
          MAX(s.leads) AS max_leads,
          MIN(s.leads) AS min_leads,
          MAX(s.conversions) AS max_conversions,
          MIN(s.conversions) AS min_conversions,
          COALESCE((
            SELECT b.cost FROM snapshots b
            WHERE b.campaign_id = s.campaign_id
              AND datetime(b.snapshot_time, '+8 hours') <= ?
              AND datetime(b.snapshot_time, '+8 hours') >= ?
            ORDER BY b.snapshot_time DESC LIMIT 1
          ), 0) AS baseline_cost,
          COALESCE((
            SELECT b.leads FROM snapshots b
            WHERE b.campaign_id = s.campaign_id
              AND datetime(b.snapshot_time, '+8 hours') <= ?
              AND datetime(b.snapshot_time, '+8 hours') >= ?
            ORDER BY b.snapshot_time DESC LIMIT 1
          ), 0) AS baseline_leads,
          COALESCE((
            SELECT b.conversions FROM snapshots b
            WHERE b.campaign_id = s.campaign_id
              AND datetime(b.snapshot_time, '+8 hours') <= ?
              AND datetime(b.snapshot_time, '+8 hours') >= ?
            ORDER BY b.snapshot_time DESC LIMIT 1
          ), 0) AS baseline_conversions
        FROM snapshots s
        WHERE datetime(s.snapshot_time, '+8 hours') >= ?
          AND datetime(s.snapshot_time, '+8 hours') < ?
        GROUP BY s.campaign_id
      `);
      const totals = new Map();
      for (const day of days) {
        const dayBoundary = day === days[0] ? String(startCst) : `${day} 00:00:00`;
        const dayEnd = day === days[days.length - 1] ? String(endCst) : `${addDays(day, 1)} 00:00:00`;
        const rows = stmt.all(
          dayBoundary, `${day} 00:00:00`,
          dayBoundary, `${day} 00:00:00`,
          dayBoundary, `${day} 00:00:00`,
          dayBoundary, dayEnd
        );
        for (const r of rows) {
          if (Number(r.max_cost || 0) <= Number(r.min_cost || 0)) continue;
          const total = totals.get(r.campaign_id) || { campaign_id: r.campaign_id, spend: 0, leads: 0, conversions: 0 };
          total.spend += Math.max(0, Number(r.max_cost || 0) - Number(r.baseline_cost || 0));
          total.leads += Math.max(0, Number(r.max_leads || 0) - Number(r.baseline_leads || 0));
          total.conversions += Math.max(0, Number(r.max_conversions || 0) - Number(r.baseline_conversions || 0));
          totals.set(r.campaign_id, total);
        }
      }
      return Array.from(totals.values())
        .filter(r => r.spend > 0)
        .map(r => ({
          campaign_id: r.campaign_id,
          spend: Number(r.spend.toFixed(2)),
          leads: Math.round(r.leads),
          conversions: Math.round(r.conversions),
        }));
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export function getSessionAccountSpend(DB_PATH, startCst, endCst) {
  const rows = getSessionSpendRows(DB_PATH, startCst, endCst);
  if (!rows) return null;
  return {
    spend: Number(rows.reduce((sum, r) => sum + Number(r.spend || 0), 0).toFixed(2)),
    leads: rows.reduce((sum, r) => sum + Number(r.leads || 0), 0),
    conversions: rows.reduce((sum, r) => sum + Number(r.conversions || 0), 0),
  };
}


function pad2(n) {
  return String(n).padStart(2, '0');
}

export function localDateString(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00+08:00`);
  d.setDate(d.getDate() + days);
  return localDateString(d);
}

/** 解析 "HH:MM-HH:MM" label,返回开始/结束分钟数(结束可>1440 表示跨天) */
function parseShiftMinutes(label) {
  const m = String(label || '').match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  let end = Number(m[3]) * 60 + Number(m[4]);
  if (end <= start) end += 1440; // 跨天班次,如 22:00-02:00
  return { start, end };
}

/** 读取某天排班,返回首班开始分钟、末班结束分钟(可能>1440) */
function loadShiftWindow(dataDir, dateStr) {
  if (!dataDir || !dateStr) return null;
  try {
    const file = path.join(dataDir, `shifts-${dateStr}.json`);
    if (!fs.existsSync(file)) return null;
    const cached = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const shifts = Array.isArray(cached.shifts) ? cached.shifts : [];
    const times = [];
    for (const s of shifts) {
      const t = parseShiftMinutes(s.label);
      if (t) times.push(t);
    }
    if (!times.length) return null;
    const firstStart = times[0].start;
    const lastEnd = times[times.length - 1].end;
    return {
      date: dateStr,
      startMin: firstStart,
      endMin: lastEnd, // 可能 >1440(跨天班次)
      startTime: fmtMin(firstStart),
      endTime: fmtMin(lastEnd % 1440),
      shifts: times,
    };
  } catch {
    return null;
  }
}

function fmtMin(min) {
  const m = min % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/**
 * 解析整场直播窗口。
 *
 * 算法:
 *   1. 从 today 开始读取排班,作为当前场次候选
 *   2. 向前回溯:若"前一日末班结束分钟 % 1440 == 当日首班开始分钟"(绝对时间连续),
 *      则合并到前一日,继续回溯
 *   3. 直到某日排班缺失或不连续 → 该日为整场起点
 *   4. 终点 = 末班结束(若 now 仍在排班窗口内则取 now 所在班次结束)
 *
 * @param {{dataDir:string, getLocalDate?:Function, now?:Date}} opts
 * @returns {null|{date,startDate,startTime,endDate,endTime,startCst,endCst,wholeStartDate,wholeStartTime,shifts:number}}
 */
export function resolveWholeSessionWindow({ dataDir, getLocalDate, now = new Date() } = {}) {
  const today = typeof getLocalDate === 'function' ? getLocalDate(now) : localDateString(now);

  // 1. 收集连续场次日期(从今天向前)
  const dates = [];
  let cur = today;
  // 防止死循环,最多回溯 10 天(超长直播>48h 也足够)
  for (let i = 0; i < 10; i++) {
    const win = loadShiftWindow(dataDir, cur);
    if (!win) break;
    dates.unshift(win);

    const prevDate = addDays(cur, -1);
    const prev = loadShiftWindow(dataDir, prevDate);
    if (!prev) break;
    // 连续判定:前日末班结束(绝对分钟)与当日首班开始衔接
    const prevEndMod = prev.endMin % 1440;
    if (prevEndMod === win.startMin) {
      cur = prevDate; // 连续,继续回溯
    } else {
      break;
    }
  }

  if (!dates.length) return null;

  const wholeStart = dates[0];
  const lastDay = dates[dates.length - 1];

  // 2. 终点:末班结束(绝对时刻)或当前时刻所在班次
  // 先按最后一天末班结束算绝对 endMin
  const lastDayStartMin = lastDay.startMin;
  const lastDayEndMin = lastDay.endMin;
  // endDate: 末班结束跨天则顺延一天
  const endCrossesDay = lastDayEndMin > 1440;
  const endDate = endCrossesDay ? addDays(lastDay.date, 1) : lastDay.date;

  // startCst / endCst(北京时间字符串)
  const startCst = `${wholeStart.date} ${wholeStart.startTime}:00`;
  const endCst = `${endDate} ${fmtMin(lastDayEndMin)}:00`;

  return {
    date: today,
    startDate: wholeStart.date,
    startTime: wholeStart.startTime,
    endDate,
    endTime: fmtMin(lastDayEndMin),
    startCst,
    endCst,
    wholeStartDate: wholeStart.date,
    wholeStartTime: wholeStart.startTime,
    dayCount: dates.length,
    shifts: dates.reduce((n, w) => n + w.shifts.length, 0),
  };
}
