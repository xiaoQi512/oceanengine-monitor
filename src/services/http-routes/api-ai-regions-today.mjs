// src/services/http-routes/api-ai-regions-today.mjs - 五大区今日直播统计 (statQuery 实时, 60s 缓存)
import { getCookieData } from '../ai-regions-api.mjs';

const REGIONS = [
  ['东区AI直播', '1842681994872135'],
  ['西区AI直播', '1842681830951944'],
  ['南区AI直播', '1842682454270468'],
  ['北区AI直播', '1842683071403332'],
  ['中区AI直播', '1842663909080452'],
];
let _cache = { at: 0, data: null };
const num = (s) => { const n = parseFloat(String(s ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };

async function fetchRegion(acc, headers) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const body = {
    DataSetKey: 'basic_ad_data', Dimensions: ['stat_time_day', 'cdp_marketing_goal'],
    EndTime: `${today} 23:59:59`,
    Filters: { ConditionRelationshipType: 1, Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [acc] }] },
    IsDownload: false, Metrics: ['stat_cost', 'clue_message_count'], PageParams: { Limit: 10, Offset: 0 },
    StartTime: `${today} 00:00:00`, Extra: { is_fill_zero: 'true', refer: '' },
  };
  const res = await fetch('https://ad.oceanengine.com/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=' + acc, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  const rows = j?.data?.StatsData?.Rows || [];
  let liveCost = 0, liveLeads = 0, allCost = 0;
  for (const r of rows) {
    const goal = String(r.Dimensions?.cdp_marketing_goal?.ValueStr || '');
    const c = num(r.Metrics?.stat_cost?.Value ?? r.Metrics?.stat_cost?.ValueStr);
    const l = num(r.Metrics?.clue_message_count?.Value ?? r.Metrics?.clue_message_count?.ValueStr);
    allCost += c;
    if (goal.includes('直播')) { liveCost += c; liveLeads += l; }
  }
  return { liveCost, liveLeads, allCost };
}

export async function serveAiRegionsToday(url, req, res) {
  if (url.pathname !== '/api/ai-regions-today' || (req && req.method !== 'GET')) return false;
  try {
    if (Date.now() - _cache.at > 60000) {
      const cd = await getCookieData();
      const headers = { ...cd.headers, 'Content-Type': 'application/json', Referer: 'https://ad.oceanengine.com/' };
      headers['Cookie'] = headers['Cookie'].replace(/[^\x20-\x7E]/g, '');
      const csrf = headers['Cookie'].match(/passport_csrf_token=([^;]+)/)?.[1];
      if (csrf && !/csrftoken=/.test(headers['Cookie'])) headers['Cookie'] += '; csrftoken=' + csrf;
      const regions = [];
      for (const [name, acc] of REGIONS) {
        const d = await fetchRegion(acc, headers);
        regions.push({ name, liveCost: Math.round(d.liveCost), liveLeads: Math.round(d.liveLeads), cpl: d.liveLeads > 0 ? Math.round(d.liveCost / d.liveLeads) : 0 });
        await new Promise(r => setTimeout(r, 400));
      }
      _cache = { at: Date.now(), data: { regions, updatedAt: new Date().toLocaleTimeString('zh-CN') } };
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(_cache.data));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e.message }));
  }
  return true;
}
