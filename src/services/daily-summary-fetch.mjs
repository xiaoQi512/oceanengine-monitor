// src/services/daily-summary-fetch.mjs - 大号日汇报数据拉取
import https from 'node:https';
import { createClient, getSessionStats } from './api-client.mjs';
import { getLocalDate, ACCOUNT_ID as LIVE_ACCOUNT_ID, VIDEO_ACCOUNT_ID } from '../utils/monitor-utils.mjs';
import { getSessionsForDate, getTodayDateStr, log } from './daily-summary-common.mjs';
import {
  buildVideoStatBody,
  parseVideoRows,
  computeDailySummary,
  zeroDailySummary,
} from '../domain/daily-summary-request.mjs';

export async function fetchLiveAllDay({
  createClientFn = createClient,
  getSessionStatsFn = getSessionStats,
  getSessionsForDateFn = getSessionsForDate,
  getTodayDateStrFn = getTodayDateStr,
  liveAccountId = LIVE_ACCOUNT_ID,
  logFn = log,
} = {}) {
  logFn('--- 拉取直播账户全天数据...');
  const client = await createClientFn({ useCache: true });
  const todayStr = getTodayDateStrFn();
  const sessions = getSessionsForDateFn(todayStr);
  if (!sessions.length) {
    logFn('  ⚠ 无可用班次，返回零数据');
    return zeroDailySummary();
  }
  logFn(`  ${sessions.length} 个班次, 首班 ${sessions[0].start}`);
  let totalConsume = 0;
  let totalLeads = 0;

  // 一次拉取全天数据（getSessionStats 返回全时段 rows，StartTime/EndTime 仅作粗过滤，
  // EndTime 为闭区间会多含 1 小时，需按班次小时半开区间 [start, end) 手动过滤）
  const firstStart = todayStr + ' ' + sessions[0].start + ':00';
  const lastEnd = todayStr + ' ' + sessions[sessions.length - 1].end + ':00';
  const dayResult = await getSessionStatsFn(client, {
    accountId: liveAccountId,
    startTime: firstStart,
    endTime: lastEnd,
  });

  for (const session of sessions) {
    const [sh] = session.start.split(':').map(Number);
    const [eh] = session.end.split(':').map(Number);
    const hours = new Set();
    for (let h = sh; h < eh; h++) hours.add(h);
    let sessionCost = 0;
    let sessionLeads = 0;
    for (const row of (dayResult.rows || [])) {
      const rowHour = parseInt(row.hour?.match(/(\d{2}):00/)?.[1] ?? -1);
      if (!hours.has(rowHour)) continue;
      sessionCost += row.cost;
      sessionLeads += row.leads;
    }
    totalConsume += sessionCost;
    totalLeads += sessionLeads;
    logFn(`    [${session.start}-${session.end}]: ¥${sessionCost.toFixed(2)} / ${sessionLeads}转化`);
  }
  const result = computeDailySummary(totalConsume, totalLeads);
  logFn(`  ✅ 直播全天: ¥${totalConsume.toFixed(2)} / ${totalLeads}转化 / CPL¥${result.cpl}`);
  return result;
}

export async function fetchVideoAllDay({
  createClientFn = createClient,
  getLocalDateFn = getLocalDate,
  videoAccountId = VIDEO_ACCOUNT_ID,
  httpsRequestFn = https.request,
  logFn = log,
} = {}) {
  logFn('▶ 拉取短视频账户全天数据 (HTTP API)...');
  const client = await createClientFn({ useCache: true });
  const today = getLocalDateFn();
  const API_BASE = 'https://ad.oceanengine.com';
  const body = JSON.stringify(buildVideoStatBody(videoAccountId, today));
  const url = API_BASE + '/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=' + videoAccountId;
  const resp = await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequestFn({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      timeout: 15000,
      headers: {
        ...(client.cookieData?.headers || {}),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ _raw: data, _status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
  const rows = resp?.data?.StatsData?.Rows || [];
  if (rows.length === 0) {
    logFn('  ⚠ 短视频API无数据返回');
    return zeroDailySummary();
  }
  const { videoConsume, videoLeads } = parseVideoRows(rows);
  const result = computeDailySummary(videoConsume, videoLeads);
  logFn(`  ✅ 短视频全天: ¥${videoConsume.toFixed(2)} / ${videoLeads}转化 / CPL¥${result.cpl}`);
  return result;
}
