// src/services/ai-regions-http.mjs - AI 区域拉取编排与兼容导出
import fs from 'node:fs';
import { getLocalDate } from '../utils/monitor-utils.mjs';
import { emptyRegionResult, parseRegionRows, buildRegionResult } from '../domain/ai-regions-stats.mjs';
import {
  httpPost,
  getCookieData,
  buildStatQueryBody,
  API_BASE,
  COOKIE_CACHE_FILE,
} from './ai-regions-api.mjs';

export { httpPost, getCookieData, buildStatQueryBody };

function log(...args) {
  console.log(`[ai-regions] ${new Date().toLocaleString()} |`, ...args);
}

export async function fetchRegion(region, {
  getCookieDataFn = getCookieData,
  httpPostFn = httpPost,
  getLocalDateFn = getLocalDate,
  logFn = log,
  fsImpl = fs,
  cookieCacheFile = COOKIE_CACHE_FILE,
  apiBase = API_BASE,
} = {}) {
  const { name, aadvid } = region;
  const today = getLocalDateFn();
  logFn(`▶ [${name}] HTTP API 拉取... aadvid=${aadvid}`);
  let cookieData;
  try {
    cookieData = await getCookieDataFn();
  } catch (e) {
    logFn(`  ⚠ [${name}] Cookie 获取失败: ${e.message}`);
    return emptyRegionResult(name);
  }

  const url = `${apiBase}/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=${aadvid}`;
  const body = buildStatQueryBody(aadvid, today);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await httpPostFn(url, body, cookieData, 15000);
      if (resp.code && resp.code !== 0 && resp.code !== 200) {
        if (attempt < 3) {
          logFn(`  [${name}] 第${attempt}次 code=${resp.code}, 刷新 Cookie 重试...`);
          try { fsImpl.unlinkSync(cookieCacheFile); } catch {}
          cookieData = await getCookieDataFn();
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
      }
      const rows = resp?.data?.StatsData?.Rows || [];
      if (rows.length === 0) {
        logFn(`  ⚠ [${name}] 无数据`);
        return emptyRegionResult(name);
      }
      const stats = parseRegionRows(rows);
      const { liveConsume, liveLeads, videoConsume, videoLeads } = stats;
      const totalLeads = liveLeads + videoLeads;
      const totalConsume = liveConsume + videoConsume;
      const cpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';
      logFn(`  ✅ [${name}] 直播¥${liveConsume.toFixed(2)}/${liveLeads}线索 + 短视频¥${videoConsume.toFixed(2)}/${videoLeads}线索 = CPL¥${cpl}`);
      return buildRegionResult(name, stats);
    } catch (e) {
      logFn(`  [${name}] 第${attempt}次异常: ${e.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }
  logFn(`  ❌ [${name}] 3次重试失败`);
  return emptyRegionResult(name);
}
