// src/services/ai-regions-api.mjs - AI 区域 HTTP API 传输与查询体
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { DATA_DIR } from '../utils/monitor-utils.mjs';

export const API_BASE = 'https://ad.oceanengine.com';
export const COOKIE_CACHE_FILE = path.join(DATA_DIR, '.oec-cookies.json');

function log(...args) {
  console.log(`[ai-regions] ${new Date().toLocaleString()} |`, ...args);
}

export function httpPost(url, body, cookieData, timeoutMs = 15000, { httpsRequestFn = https.request } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const req = httpsRequestFn({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        ...cookieData.headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
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
    req.write(bodyStr);
    req.end();
  });
}

export async function getCookieData({
  cookieCacheFile = COOKIE_CACHE_FILE,
  fsImpl = fs,
  logFn = log,
} = {}) {
  try {
    if (fsImpl.existsSync(cookieCacheFile)) {
      const cached = JSON.parse(fsImpl.readFileSync(cookieCacheFile, 'utf-8'));
      if (cached.expireAt > Date.now()) return cached;
    }
  } catch {}
  logFn('  🔧 Cookie 缓存失效, 通过 CDP 提取...');
  const { createClient } = await import('./api-client.mjs');
  const client = await createClient({ useCache: false });
  return client.cookieData;
}

export function buildStatQueryBody(aadvid, dateStr) {
  return {
    DataSetKey: 'basic_ad_data',
    Dimensions: ['stat_time_day', 'cdp_marketing_goal'],
    EndTime: `${dateStr} 23:59:59`,
    Filters: {
      ConditionRelationshipType: 1,
      Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [aadvid] }],
    },
    IsDownload: false,
    Metrics: ['stat_cost', 'convert_cnt', 'conversion_cost', 'clue_message_count', 'message_action', 'form'],
    OrderBy: [{ Field: 'stat_time_day', Type: 2 }],
    PageParams: { Limit: 50, Offset: 0 },
    StartTime: `${dateStr} 00:00:00`,
  };
}
