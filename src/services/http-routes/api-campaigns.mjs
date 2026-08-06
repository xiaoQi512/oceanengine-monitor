// src/services/http-routes/api-campaigns.mjs - 计划查询 API
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function numOf(v) {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}

function parseCtrPct(v) {
  const n = parseFloat(String(v ?? '').replace(/%/g, ''));
  if (!Number.isFinite(n)) return 0;
  return n > 0 && n < 1 ? n * 100 : n;
}

async function fetchCampaigns(getApiClient) {
  const api = await getApiClient();
  const client = await api.createClient({ useCache: true });
  const result = await api.getProjects(client, { page: 1, pageSize: 100 });
  return result.projects || [];
}

export function normalizeCampaign(p, mode = 'default') {
  const m = p.metrics || {};
  const statusName = p.project_status_first_name || p.project_status_name || p.status_str || p.status || '';
  let stdStatus = statusName;
  if (statusName.includes('启用')) stdStatus = '投放中';
  else if (statusName.includes('暂停')) stdStatus = '未投放(已暂停)';
  else if (statusName.includes('超出预算') || statusName.includes('预算')) stdStatus = '未投放(超出预算)';
  const grouped = mode === 'grouped';
  const spend = grouped
    ? numOf(m.stat_cost ?? p.stat_cost)
    : Number(m.stat_cost || p.stat_cost || 0);
  const leads = grouped
    ? numOf(m.attribution_all_convert_clue_count ?? m.clue_message_count)
    : Number(m.attribution_all_convert_clue_count || m.clue_message_count || 0);
  const conversions = grouped ? numOf(m.convert_cnt) : Number(m.convert_cnt || 0);
  return {
    id: String(p.project_id || p.campaign_id || p.id || ''),
    name: p.project_name || p.name || p.project_name || '',
    status: stdStatus,
    rawStatus: statusName,
    // 项目开关状态(逆向字段):0=启用(按钮显示"暂停")、1=暂停(按钮显示"启用")、undefined=未知
    optStatus: p.campaign_opt_status ?? p.opt_status,
    spend,
    conversions,
    leads,
    cpa: spend > 0 && conversions > 0 ? Number((spend / conversions).toFixed(2)) : 0,
    budget: grouped ? Number(p.campaign_budget || p.budget || 0) : numOf(p.campaign_budget ?? p.budget),
    bid: p.project_deep_cpa_bid || p.bid || '',
    ctr: parseCtrPct(m.ctr ?? p.ctr),
    cpm: grouped ? Number(m.cpm_platform || 0) : numOf(m.cpm_platform),
    cvr: grouped ? Number(m.conversion_rate || 0) : numOf(m.conversion_rate),
    privateMsgOpen: numOf(m.message_action ?? p.privateMsgOpen),
  };
}

// 整场直播窗口:从本场直播开播时刻起累计,跨天合并(超长直播>48h 也完整)
import { resolveWholeSessionWindow, getSessionSpendRows } from '../session-window.mjs';

export function resolveSessionWindow(opts) {
  return resolveWholeSessionWindow(opts);
}

export { getSessionSpendRows };

export function applySessionSpend(list, sessionRows) {
  const byId = new Map(sessionRows.map(r => [r.campaign_id, r]));
  const sessionPlans = [];
  for (const p of list) {
    const row = byId.get(p.id);
    if (!row) continue;
    const spend = Math.max(0, Number(row.spend || 0));
    const leads = Math.max(0, Math.round(Number(row.leads || 0)));
    const conversions = Math.max(0, Math.round(Number(row.conversions || row.leads || 0)));
    sessionPlans.push({
      ...p,
      spend: Number(spend.toFixed(2)),
      leads,
      conversions,
      cpa: spend > 0 && conversions > 0 ? Number((spend / conversions).toFixed(2)) : 0,
    });
  }
  return sessionPlans;
}

function buildGroups(plans, groups, classifyDeliveryType, emptyGroupSummary, summarizeGroup) {
  const grouped = {};
  for (const g of groups) grouped[g] = { summary: emptyGroupSummary(g), plans: [] };
  const ungrouped = [];
  for (const p of plans) {
    const g = classifyDeliveryType(p.name);
    if (g && grouped[g]) grouped[g].plans.push(p);
    else ungrouped.push(p);
  }
  for (const g of groups) grouped[g].summary = summarizeGroup(grouped[g].plans, g);
  return { groups: grouped, ungrouped };
}

export async function serveCampaigns(url, req, res, ctx) {
  const { classifyDeliveryType, emptyGroupSummary, summarizeGroup, getApiClient, DB_PATH } = ctx;

  if (url.pathname === '/api/campaigns') {
    try {
      const projects = await fetchCampaigns(getApiClient);
      const list = projects.map(p => normalizeCampaign(p, 'default'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ campaigns: list, total: list.length }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, campaigns: [] }));
    }
    return true;
  }

  if (url.pathname === '/api/campaigns/grouped') {
    try {
      const projects = await fetchCampaigns(getApiClient);
      const list = projects.map(p => normalizeCampaign(p, 'grouped'));
      const GROUPS = ['简单投', '画面直投', '短引直'];

      // 拆分: 有消耗 vs 未启动(本场无消耗)
      const spendingPlans = list.filter(p => Number(p.spend || 0) > 0);
      const inactivePlans = list.filter(p => Number(p.spend || 0) === 0);

      const spendingGrouped = buildGroups(spendingPlans, GROUPS, classifyDeliveryType, emptyGroupSummary, summarizeGroup);

      // 本场窗口优先按快照差值过滤，跨天直播时不会误用“今日消耗”口径
      const sessionWindow = resolveSessionWindow({ dataDir: ctx.DATA_DIR, getLocalDate: ctx.getLocalDate });
      const sessionRows = sessionWindow
        ? getSessionSpendRows(DB_PATH, sessionWindow.startCst, sessionWindow.endCst)
        : null;
      let sessionPlans = spendingPlans;
      let sessionInactivePlans = inactivePlans;
      if (sessionRows) {
        sessionPlans = applySessionSpend(list, sessionRows);
        const sessionIds = new Set(sessionPlans.map(p => p.id));
        sessionInactivePlans = list.filter(p => !sessionIds.has(p.id));
      }

      const sessionGrouped = buildGroups(sessionPlans, GROUPS, classifyDeliveryType, emptyGroupSummary, summarizeGroup);
      const sessionInactiveGrouped = buildGroups(sessionInactivePlans, GROUPS, classifyDeliveryType, emptyGroupSummary, summarizeGroup);

      // 全账户汇总(只对本场有消耗计划)
      const totalSummary = summarizeGroup(sessionPlans, '本场');

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        spending: spendingGrouped,
        inactive: sessionInactiveGrouped,
        session: {
          ...sessionGrouped,
          totalSummary,
          window: sessionWindow
            ? {
                date: sessionWindow.date,
                startTime: sessionWindow.startTime,
                endTime: sessionWindow.endTime,
                startDate: sessionWindow.startDate,
                endDate: sessionWindow.endDate,
                wholeStartDate: sessionWindow.wholeStartDate,
                wholeStartTime: sessionWindow.wholeStartTime,
                dayCount: sessionWindow.dayCount,
              }
            : null,
        },
        totalSummary,
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, spending: {}, inactive: {}, totalSummary: {} }));
    }
    return true;
  }

  // 历史数据查询(未启动计划的昨日/3日/7日数据)
  if (url.pathname === '/api/campaigns/history' && req && (!req.method || req.method === 'POST')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { planIds, period } = JSON.parse(body || '{}');
        if (!Array.isArray(planIds) || planIds.length === 0 || ![1,3,7].includes(period)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'planIds (数组) 和 period (1|3|7) 必填' }));
          return;
        }
        if (!DB_PATH) {
          res.end(JSON.stringify({ plans: [] }));
          return;
        }
        const db = new Database(DB_PATH, { readonly: true });
        // 对每个 plan,按天聚合 MAX-MIN spend/leads,再汇总
        const placeholders = planIds.map(() => '?').join(',');
        const rows = db.prepare(`
          SELECT
            campaign_id,
            SUM(max_cost - min_cost) AS period_spend,
            SUM(max_leads - min_leads) AS period_leads
          FROM (
            SELECT
              campaign_id,
              date(datetime(snapshot_time, '+8 hours')) AS day,
              MAX(cost) AS max_cost,
              MIN(cost) AS min_cost,
              MAX(leads) AS max_leads,
              MIN(leads) AS min_leads
            FROM snapshots
            WHERE campaign_id IN (${placeholders})
              AND date(datetime(snapshot_time, '+8 hours')) >= date('now', '+8 hours', ?)
              AND date(datetime(snapshot_time, '+8 hours')) < date('now', '+8 hours')
              AND source_type IN ('5min', '15min')
            GROUP BY campaign_id, day
          )
          GROUP BY campaign_id
        `).all(...planIds, `-${period} days`);
        // 补充每个 plan 的最新 cpm/ctr(作为该期代表值)
        const cpmCtrStmt = db.prepare(`
          SELECT cpm, ctr FROM snapshots
          WHERE campaign_id = ?
            AND date(datetime(snapshot_time, '+8 hours')) >= date('now', '+8 hours', ?)
            AND date(datetime(snapshot_time, '+8 hours')) < date('now', '+8 hours')
            AND source_type IN ('5min', '15min')
            AND cpm IS NOT NULL AND cpm > 0
          ORDER BY snapshot_time DESC LIMIT 1
        `);
        const plans = rows.map(r => {
          const meta = cpmCtrStmt.get(r.campaign_id, `-${period} days`);
          return {
            id: r.campaign_id,
            spend: Number((r.period_spend || 0).toFixed(2)),
            leads: r.period_leads || 0,
            cpl: r.period_spend > 0 && r.period_leads > 0 ? Number((r.period_spend / r.period_leads).toFixed(2)) : 0,
            cpm: meta ? Number(meta.cpm || 0) : 0,
            ctr: meta ? Number((meta.ctr || 0) * 100) : 0,
          };
        });
        // 按消耗降序
        plans.sort((a, b) => b.spend - a.spend);
        db.close();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ plans, period }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message, plans: [] }));
      }
    });
    return true;
  }

  return false;
}
