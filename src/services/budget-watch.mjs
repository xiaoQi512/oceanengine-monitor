// src/services/budget-watch.mjs — AI 大区预算使用率监控 (≥80% 首次跨过时飞书监控群报警)
// 汇报: 该账户近 2 小时消耗、线索成本(CPL); PM2 cron */30; state 幂等(同账户同日只报一次)
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../utils/monitor-utils.mjs';
import { getCookieData } from './ai-regions-api.mjs';
import { pushToLark } from './ai-regions-push.mjs';

const REGIONS = [
  ['东区AI直播', '1842681994872135'],
  ['西区AI直播', '1842681830951944'],
  ['南区AI直播', '1842682454270468'],
  ['北区AI直播', '1842683071403332'],
  ['中区AI直播', '1842663909080452'],
];
const envLine = (k) => { const line = fs.readFileSync(path.join(DATA_DIR, '..', '.env'), 'utf8').split(/\r?\n/).find(l => l.startsWith(k + '=')); return line ? line.slice(k.length + 1).trim() : ''; };
const BUDGET = Number(envLine('AI_DAILY_BUDGET')) || 60000;
const THRESHOLD = 0.8; // 首次跨过 80% 触发
const STATE_FILE = path.join(DATA_DIR, 'budget-watch-state.json');
const MONITOR_CHAT = (fs.readFileSync(path.join(DATA_DIR, '..', '.env'), 'utf8').match(/LARK_MONITOR_CHAT_ID=(.+)/) || [])[1]?.trim() || '';
const log = (m) => console.log(`[budget-watch ${new Date().toLocaleTimeString('zh-CN')}] ${m}`);

// 时段闸: 7-23 点外不检查 (非直播时段消耗静止)
const hour = Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 13));
if (hour < 7 || hour >= 23) { log('非直播时段, 跳过'); process.exit(0); }

const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
if (state.date !== today) state = { date: today, alerted: {} };

const cd = await getCookieData();
const headers = { ...cd.headers, 'Content-Type': 'application/json', Referer: 'https://ad.oceanengine.com/' };
headers['Cookie'] = headers['Cookie'].replace(/[^\x20-\x7E]/g, '');
const csrf = headers['Cookie'].match(/passport_csrf_token=([^;]+)/)?.[1];
if (csrf && !/csrftoken=/.test(headers['Cookie'])) headers['Cookie'] += '; csrftoken=' + csrf;

const num = (s) => { const n = parseFloat(String(s ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };

async function statDay(acc) {
  const body = {
    DataSetKey: 'basic_ad_data', Dimensions: ['stat_time_day'],
    EndTime: `${today} 23:59:59`,
    Filters: { ConditionRelationshipType: 1, Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [acc] }] },
    IsDownload: false, Metrics: ['stat_cost', 'convert_cnt'],
    PageParams: { Limit: 5, Offset: 0 },
    StartTime: `${today} 00:00:00`, Extra: { is_fill_zero: 'true', refer: '' },
  };
  const res = await fetch('https://ad.oceanengine.com/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=' + acc, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  const rows = j?.data?.StatsData?.Rows || [];
  return rows.reduce((a, r) => ({ cost: a.cost + num(r.Metrics?.stat_cost?.Value ?? r.Metrics?.stat_cost?.ValueStr), leads: a.leads + num(r.Metrics?.convert_cnt?.Value ?? r.Metrics?.convert_cnt?.ValueStr) }), { cost: 0, leads: 0 });
}

async function statLast2h(acc) {
  const nowCst = new Date(Date.now() + 8 * 3600000);
  const end = nowCst.toISOString().slice(0, 19).replace('T', ' ');
  const startD = new Date(nowCst - 2 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  const body = {
    DataSetKey: 'basic_ad_data', Dimensions: ['stat_time_hour'],
    EndTime: end,
    Filters: { ConditionRelationshipType: 1, Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [acc] }] },
    IsDownload: false, Metrics: ['stat_cost', 'convert_cnt'],
    PageParams: { Limit: 10, Offset: 0 },
    StartTime: startD, Extra: { is_fill_zero: 'true', refer: '' },
  };
  const res = await fetch('https://ad.oceanengine.com/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=' + acc, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  const rows = j?.data?.StatsData?.Rows || [];
  return rows.reduce((a, r) => ({ cost: a.cost + num(r.Metrics?.stat_cost?.Value ?? r.Metrics?.stat_cost?.ValueStr), leads: a.leads + num(r.Metrics?.convert_cnt?.Value ?? r.Metrics?.convert_cnt?.ValueStr) }), { cost: 0, leads: 0 });
}

const alerts = [];
for (const [name, acc] of REGIONS) {
  if (state.alerted[acc]) continue; // 已报过
  let day, h2;
  try { day = await statDay(acc); } catch (e) { log(`${name} 当日拉取失败: ${e.message}`); continue; }
  const ratio = BUDGET > 0 ? day.cost / BUDGET : 0;
  log(`${name} 消耗${Math.round(day.cost)}/${BUDGET} = ${(ratio * 100).toFixed(1)}%`);
  if (ratio < THRESHOLD) continue;
  try { h2 = await statLast2h(acc); } catch (e) { log(`${name} 近2h拉取失败: ${e.message}`); h2 = { cost: 0, leads: 0 }; }
  const cpl = h2.leads > 0 ? Math.round(h2.cost / h2.leads) : 0;
  const msg = [
    `⚠️【预算预警】${name} 预算使用率 ${(ratio * 100).toFixed(1)}%`,
    `预算 ${BUDGET.toLocaleString()}，今日已消耗 ${Math.round(day.cost).toLocaleString()}（线索 ${Math.round(day.leads)} 条）`,
    `— 近 2 小时 —`,
    `消耗 ${Math.round(h2.cost).toLocaleString()} 元`,
    `线索 ${Math.round(h2.leads)} 条，线索成本 ${cpl > 0 ? cpl.toLocaleString() + ' 元/条' : '暂无线索'}`,
    `近 2 小时时段：${new Date(Date.now() - 2 * 3600000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} - ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
  ].join('\n');
  const ok = await pushToLark(msg, { chatId: MONITOR_CHAT });
  if (ok) { state.alerted[acc] = new Date().toLocaleTimeString('zh-CN'); alerts.push(name); }
  else log(`${name} 推送失败, 下轮重试`);
  await new Promise(r => setTimeout(r, 1500));
}
if (alerts.length) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  log(`已报警: ${alerts.join(', ')} → state 已记录`);
} else {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  log('无账户跨过阈值');
}
