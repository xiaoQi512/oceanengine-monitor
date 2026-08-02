// snapshot-db.mjs - 巨量引擎快照数据库
// 从 15分钟监控快照 计算主播场次消耗/线索数据
// 快照缺失时回退到 HTTP getHourlyStats API
//
// 用法:
//   import { getShiftDelta, getSnapshotAt, getDailyShiftReport } from './巨量引擎快照数据库/snapshot-db.mjs';
//   const delta = await getShiftDelta(dateStr, shiftLabel, { apiClient });
//   // → { spend: 5633, leads: 46, cpl: 122.46, fromCache: true }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..', '..');

// 快照目录（与 monitor-data 保持一致，后续可迁移到本目录）
const MONITOR_DATA_DIR = process.env.SNAPSHOT_DATA_DIR
  || path.join(PROJECT_DIR, 'monitor-data');

// ====== CST ↔ UTC 转换 ======

/**
 * CST 时间 (北京时间) 转 UTC 日期+HH:MM，用于定位快照文件
 * @param {string} dateStr - "2026-07-10"
 * @param {string} timeStr - "06:30" (CST)
 * @returns {{utcDate: string, utcHHMM: string}}
 */
function cstToUtc(dateStr, timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  let utcH = h - 8;
  let utcDate = dateStr;
  if (utcH < 0) {
    utcH += 24;
    // 纯字符串计算前一天（避免 Date 对象时区陷阱）
    const [y, mo, d] = dateStr.split('-').map(Number);
    const prevDate = new Date(Date.UTC(y, mo - 1, d) - 86400000);
    utcDate = prevDate.toISOString().slice(0, 10);
  }
  return { utcDate, utcHHMM: String(utcH).padStart(2, '0') + ':' + String(m).padStart(2, '0') };
}

/**
 * "HH:MM" → UTC 文件名时间片段 "HH-MM"
 */
function hhmmToFileSegment(hhmm) {
  return hhmm.replace(':', '-');
}

// ====== 快照文件查找（带缓存） ======

const _scanCache = new Map(); // dateStr → { at: Date.now(), files: string[] }

/**
 * 扫描指定日期的所有 15 分钟快照文件
 * @param {string} utcDate - "2026-07-10"
 * @returns {string[]} 文件路径列表
 */
function scanSnapshotFiles(utcDate) {
  const now = Date.now();
  const cached = _scanCache.get(utcDate);
  const pattern = `${utcDate}T`;

  // 缓存命中时快速校验文件数是否变化（新快照写入会触发刷新）
  if (cached && (now - cached.at) < 30000) {
    try {
      const currentCount = fs.readdirSync(MONITOR_DATA_DIR)
        .filter(f => f.startsWith(pattern) && f.endsWith('.json') && !f.startsWith('5m-')).length;
      if (currentCount === cached.count) return cached.files;
    } catch {}
  }

  let files;
  try {
    files = fs.readdirSync(MONITOR_DATA_DIR)
      .filter(f => f.startsWith(pattern) && f.endsWith('.json') && !f.startsWith('5m-'))
      .map(f => path.join(MONITOR_DATA_DIR, f))
      .sort();
  } catch {
    files = [];
  }
  _scanCache.set(utcDate, { at: now, files, count: files.length });
  return files;
}

// ====== 5分钟快照文件扫描（与15分钟合并使用） ======

const _5mScanCache = new Map(); // dateStr → { at: Date.now(), files: string[] }

/**
 * 扫描指定日期的所有 5 分钟快照文件
 * @param {string} utcDate - "2026-07-10"
 * @returns {string[]} 文件路径列表
 */
function scan5mFiles(utcDate) {
  const now = Date.now();
  const cached = _5mScanCache.get(utcDate);

  // 5分钟快照文件名使用北京时间（如 5m-2026-08-01T07-31-02.json）
  // 需同时按 UTC 日期和北京时间查
  const bjDate = utcToBeijingDate(utcDate);
  const patterns = ['5m-' + utcDate + 'T', '5m-' + bjDate + 'T'];

  if (cached && (now - cached.at) < 30000) {
    try {
      const currentCount = fs.readdirSync(MONITOR_DATA_DIR)
        .filter(f => patterns.some(p => f.startsWith(p)) && f.endsWith('.json')).length;
      if (currentCount === cached.count) return cached.files;
    } catch {}
  }

  let files;
  try {
    files = fs.readdirSync(MONITOR_DATA_DIR)
      .filter(f => patterns.some(p => f.startsWith(p)) && f.endsWith('.json'))
      .map(f => path.join(MONITOR_DATA_DIR, f))
      .sort();
  } catch {
    files = [];
  }
  _5mScanCache.set(utcDate, { at: now, files, count: files.length });
  return files;
}

// UTC date "2026-07-31" → Beijing date "2026-08-01"
function utcToBeijingDate(utcDate) {
  const [y, m, d] = utcDate.split('-').map(Number);
  const dObj = new Date(Date.UTC(y, m-1, d) + 8*3600000);
  return dObj.toISOString().slice(0, 10);
}

/**
 * 从 5m 文件名提取时间片段
 * "5m-2026-07-10T02-30-00.json" → "02-30"
 */
function extractTimeFrom5mFile(filePath) {
  const name = path.basename(filePath, '.json');
  // 去掉 "5m-" 前缀后用同一逻辑提取
  const bare = name.startsWith('5m-') ? name.slice(3) : name;
  const match = bare.match(/T(\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * 从文件名提取 "HH-MM" 时间片段
 * "2026-07-10T02-30-01.json" → "02-30"
 */
function extractTimeFromFile(filePath) {
  const name = path.basename(filePath, '.json');
  const match = name.match(/T(\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * "HH:MM" 转当天分钟数
 */
function parseMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * "HH-MM" 文件格式转分钟数
 */
function fileSegToMinutes(seg) {
  return parseMinutes(seg.replace('-', ':'));
}

/**
 * 查找最接近指定 UTC 时间（±30 分钟内）的 15 分钟快照
 * @param {string} utcDate - "2026-07-10"
 * @param {string} utcHHMM - "02:30"
 * @returns {{filePath: string, diffMin: number}|null}
 */
function findClosestSnapshot(utcDate, utcHHMM) {
  const files = scanSnapshotFiles(utcDate);
  if (files.length === 0) return null;

  const targetMin = parseMinutes(utcHHMM);
  let best = null;
  let bestDiff = Infinity;

  for (const f of files) {
    const seg = extractTimeFromFile(f);
    if (!seg) continue;
    const fileMin = fileSegToMinutes(seg);
    const diff = Math.abs(fileMin - targetMin);
    if (diff <= 30 && diff < bestDiff) {
      bestDiff = diff;
      best = f;
    }
  }
  return best ? { filePath: best, diffMin: bestDiff } : null;
}

// ====== 快照读取 ======

/**
 * 读取 15 分钟快照的 summary 数据
 * @returns {{time: string, totalSpend: number, totalLeads: number, totalConversions: number, totalActive: number}}
 */
function readSnapshotSummary(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const s = data.summary || {};
    return {
      time: data.time || '',
      totalSpend: s.totalSpend || 0,
      totalLeads: s.totalLeads || 0,
      totalConversions: s.totalConversions || 0,
      totalActive: s.totalActive || 0,
    };
  } catch (e) {
    return null;
  }
}

/**
 * 读取 5 分钟快照的 summary 数据（字段映射到与 15m 相同结构）
 * 5m 结构: { accountSpend, totalConv, time, activeCount }
 * 映射为:    { totalSpend, totalLeads, totalConversions, totalActive, time }
 * @returns {{time: string, totalSpend: number, totalLeads: number, totalConversions: number, totalActive: number, _source: string}|null}
 */
function read5mSnapshotSummary(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return {
      time: data.time || '',
      totalSpend: data.accountSpend || 0,
      totalLeads: data.totalConv || 0,
      totalConversions: data.totalConv || 0,
      totalActive: data.activeCount || 0,
      _source: '5m',
    };
  } catch (e) {
    return null;
  }
}

/**
 * 获取前一个 UTC 日期字符串 (用于跨午夜搜索)
 */
function prevUtcDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d) - 86400000);
  return prev.toISOString().slice(0, 10);
}

/**
 * 获取后一个 UTC 日期字符串
 */
function nextUtcDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + 86400000);
  return next.toISOString().slice(0, 10);
}

/**
 * 获取指定时刻的最佳快照 summary（15m + 5m 时间线合并搜索）
 *
 * 策略：统一扫描两线快照，取绝对距离最近的快照。
 *       **注意** 5m 文件用 CST(本地时间)命名，15m 文件用 UTC 命名。
 *       若 15m 和 5m 距离相近（≤2 分钟），优先用 15m（数据更全，含 campaign 明细）。
 *       15m 容差 ±30 分钟，5m 容差 ±10 分钟。
 *
 * @param {string} utcDate - UTC 日期 "2026-07-11"
 * @param {string} utcHHMM - UTC HH:MM "02:50"
 * @param {string} [cstDate] - CST 日期 (用于 5m 文件搜索，与 utcDate 可能跨天)
 * @param {string} [cstHHMM] - CST HH:MM "10:50" (用于 5m 文件搜索)
 * @returns {object|null} summary 对象（含 _diffMin/_snapshot/_source 元数据）或 null
 */
function getSnapshotAt(utcDate, utcHHMM, cstDate, cstHHMM) {
  const utcTargetMin = parseMinutes(utcHHMM);
  const candidates = [];

  // 15m 快照候选（UTC 命名，±30 分钟容差）
  function add15mFromDate(date, minuteOffset) {
    for (const f of scanSnapshotFiles(date)) {
      const seg = extractTimeFromFile(f);
      if (!seg) continue;
      const diff = Math.abs(fileSegToMinutes(seg) + minuteOffset - utcTargetMin);
      if (diff <= 30) candidates.push({ filePath: f, diffMin: diff, source: '15m' });
    }
  }
  add15mFromDate(utcDate, 0);

  // 跨午夜搜索：除当日 0 分钟外，目标分钟 < 1440-30 都补前一天末
  if (utcTargetMin > 0 && utcTargetMin < 1410) {
    const prevDate = prevUtcDate(utcDate);
    if (prevDate) add15mFromDate(prevDate, -1440);
  }
  if (utcTargetMin > 1410) {
    const nextDate = nextUtcDate(utcDate);
    if (nextDate) add15mFromDate(nextDate, +1440);
  }

  // 5m 快照候选（CST 命名，±10 分钟容差）
  //   nowISO() 用 new Date().getHours() → 本地时间，故 5m 文件名是 CST 时区
  const cstD = cstDate || utcDate;
  const cstTargetMin = cstHHMM ? parseMinutes(cstHHMM) : utcTargetMin;
  for (const f of scan5mFiles(cstD)) {
    const seg = extractTimeFrom5mFile(f);
    if (!seg) continue;
    const diff = Math.abs(fileSegToMinutes(seg) - cstTargetMin);
    if (diff <= 10) candidates.push({ filePath: f, diffMin: diff, source: '5m' });
  }

  if (candidates.length === 0) return null;

  // 按距离升序排列
  candidates.sort((a, b) => a.diffMin - b.diffMin);

  const best = candidates[0];

  // 若最近的是 5m，检查是否有距离差距 ≤2 分钟的 15m 候选（优先 15m—数据更全）
  if (best.source === '5m') {
    const nearby15m = candidates.find(c => c.source === '15m' && c.diffMin <= best.diffMin + 2);
    if (nearby15m) {
      const summary = readSnapshotSummary(nearby15m.filePath);
      if (summary) {
        return { ...summary, _diffMin: nearby15m.diffMin, _snapshot: path.basename(nearby15m.filePath), _source: '15m' };
      }
    }
    // 没有近 15m，直接用最近的 5m
    const summary = read5mSnapshotSummary(best.filePath);
    if (summary) {
      return { ...summary, _diffMin: best.diffMin, _snapshot: path.basename(best.filePath), _source: '5m' };
    }
    return null;
  }

  // 最近的是 15m，直接用
  const summary = readSnapshotSummary(best.filePath);
  if (summary) {
    return { ...summary, _diffMin: best.diffMin, _snapshot: path.basename(best.filePath), _source: '15m' };
  }
  return null;
}

// ====== 场次差值计算（核心接口） ======

/**
 * 计算指定场次的消耗/线索数据（优先快照差值，缺失时 API 兜底）
 *
 * @param {string} dateStr - "2026-07-10"
 * @param {{label: string, startTime?: string, endTime?: string, hours?: number[]}} shift
 * @param {object} options
 * @param {object} [options.apiClient] - 用于 API 兜底的 createClient() 返回值
 * @param {string} [options.accountId] - 广告主 ID
 * @returns {Promise<{spend: number, leads: number, cpl: number, fromCache: boolean, detail: object}>}
 */
export async function getShiftDelta(dateStr, shift, options = {}) {
  const { apiClient, accountId } = options;

  // 解析班次起止时间 (CST)
  let startTime, endTime;
  if (shift.startTime && shift.endTime) {
    startTime = shift.startTime;
    endTime = shift.endTime;
  } else if (shift.label) {
    const m = shift.label.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
    if (!m) throw new Error(`无法解析班次时间: ${shift.label}`);
    startTime = m[1];
    endTime = m[2];
  } else {
    throw new Error('班次缺少时间信息');
  }

  // 转 UTC 查找快照
  const startUtc = cstToUtc(dateStr, startTime);
  const endUtc = cstToUtc(dateStr, endTime);

  const startSnap = getSnapshotAt(startUtc.utcDate, startUtc.utcHHMM, dateStr, startTime);
  const endSnap = getSnapshotAt(endUtc.utcDate, endUtc.utcHHMM, dateStr, endTime);

  if (startSnap && endSnap) {
    const spend = endSnap.totalSpend - startSnap.totalSpend;
    const leads = endSnap.totalLeads - startSnap.totalLeads;
    const cpl = leads > 0 ? parseFloat((spend / leads).toFixed(2)) : 0;

    return {
      spend,
      leads,
      cpl,
      fromCache: true,
      detail: {
        startSnapshot: startSnap._snapshot,
        startSource: startSnap._source || '15m',
        startSpend: startSnap.totalSpend,
        startLeads: startSnap.totalLeads,
        startDiff: startSnap._diffMin,
        endSnapshot: endSnap._snapshot,
        endSource: endSnap._source || '15m',
        endSpend: endSnap.totalSpend,
        endLeads: endSnap.totalLeads,
        endDiff: endSnap._diffMin,
      },
    };
  }

  // 快照缺失 → API 兜底
  if (!apiClient) {
    throw new Error(
      `快照缺失 (start=${startSnap ? 'OK' : '缺失'}, end=${endSnap ? 'OK' : '缺失'})，且未提供 apiClient 兜底`
    );
  }

  const client = apiClient;
  const aid = accountId || '1842681352509635';

  // 用 hours 数组拉取整点小时数据（API 只能整点）
  const hours = shift.hours || [];
  if (hours.length === 0) {
    const [sh] = startTime.split(':').map(Number);
    const [eh] = endTime.split(':').map(Number);
    for (let h = sh; h <= eh; h++) hours.push(h);
  }
  const h1 = hours[0];
  const h2 = hours[hours.length - 1];

  // 支持历史日期：用 dateStr 构造 StartTime/EndTime
  const reqStart = `${dateStr} ${String(h1).padStart(2, '0')}:00:00`;
  const reqEnd = `${dateStr} ${String(h2 + 1).padStart(2, '0')}:00:00`;

  // 调用 getSessionStats 统一接口（与 oceanengine-api-client 去重）
  const { getSessionStats } = await import('../platform/oec-client.mjs');
  const { total, rows } = await getSessionStats(client, {
    accountId: aid,
    startTime: reqStart,
    endTime: reqEnd,
  });

  // 按目标小时过滤并汇总（getSessionStats 返回全时段，需过滤）
  let totalSpend = 0, totalLeads = 0;
  for (const row of rows) {
    const rowHour = parseInt(row.hour?.match(/(\d{2}):00/)?.[1] ?? -1);
    if (!hours.includes(rowHour)) continue;
    totalSpend += row.cost;
    totalLeads += row.leads;
  }
  const cpl = totalLeads > 0 ? parseFloat((totalSpend / totalLeads).toFixed(2)) : 0;

  return {
    spend: totalSpend,
    leads: totalLeads,
    cpl,
    fromCache: false,
    detail: {
      reason: startSnap ? 'endSnapshot缺失' : (endSnap ? 'startSnapshot缺失' : '两端快照均缺失'),
      apiHours: hours,
    },
  };
}

/**
 * 获取一天所有场次的汇总报告
 * @param {string} dateStr - "2026-07-10"
 * @param {Array} shifts - 排班数组 [{label, startTime, endTime, hours, row}]
 * @param {object} options - 同 getShiftDelta
 * @returns {Promise<{date: string, shifts: Array, totalSpend: number, totalLeads: number}>}
 */
export async function getDailyShiftReport(dateStr, shifts, options = {}) {
  const results = [];
  let totalSpend = 0, totalLeads = 0;
  const missedShifts = [];

  for (const shift of shifts) {
    try {
      const delta = await getShiftDelta(dateStr, shift, options);
      results.push({ ...shift, ...delta });
      totalSpend += delta.spend;
      totalLeads += delta.leads;
    } catch (e) {
      results.push({ ...shift, error: e.message });
      missedShifts.push(shift.label);
    }
  }

  return {
    date: dateStr,
    shifts: results,
    totalSpend,
    totalLeads,
    missedShifts,
  };
}

// ====== 数据迁移工具 ======

/**
 * 将 monitor-data 中的快照文件按日期归档到快照数据库子目录
 * 暂不执行迁移（防止影响运行中监控），仅提供工具函数
 */
export function getSnapshotStats() {
  const stats = { total5m: 0, total15m: 0, sizeBytes: 0, dateRange: [] };
  try {
    const files = fs.readdirSync(MONITOR_DATA_DIR).filter(f => f.endsWith('.json'));
    const dates = new Set();
    for (const f of files) {
      const stat = fs.statSync(path.join(MONITOR_DATA_DIR, f));
      stats.sizeBytes += stat.size;
      if (f.startsWith('5m-')) {
        stats.total5m++;
        const d = f.match(/5m-(\d{4}-\d{2}-\d{2})/);
        if (d) dates.add(d[1]);
      } else {
        const d = f.match(/^(\d{4}-\d{2}-\d{2})/);
        if (d) {
          stats.total15m++;
          dates.add(d[1]);
        }
      }
    }
    stats.dateRange = [...dates].sort();
  } catch { /* ignore */ }
  stats.sizeMB = (stats.sizeBytes / 1048576).toFixed(1);
  return stats;
}

// 导出工具函数（供测试/调试使用）
export { cstToUtc, getSnapshotAt, MONITOR_DATA_DIR };
