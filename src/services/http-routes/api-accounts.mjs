// src/services/http-routes/api-accounts.mjs - 账户总览与详情 API
import { normalizeCampaign } from './api-campaigns.mjs';

export async function serveAccounts(url, req, res, ctx) {
  const { getLatestSnapshot, ACCOUNT_ID, ACCOUNT_NAME, getApiClient } = ctx;

  if (url.pathname === '/api/accounts' && (!req || req.method === 'GET')) {
    try {
      const snap = getLatestSnapshot();
      const accounts = [];
      if (snap && snap.summary) {
        const sm = snap.summary;
        const spend = Number(sm.accountSpend ?? sm.totalSpend ?? 0);
        const leads = Number(sm.totalLeads ?? 0);
        const conversions = Number(sm.totalConversions ?? 0);
        const cpa = conversions > 0 ? Number((spend / conversions).toFixed(2)) : 0;
        accounts.push({
          id: ACCOUNT_ID,
          name: ACCOUNT_NAME,
          platform: 'oceanengine',
          spend,
          leads,
          cpa,
          activeCount: Number(sm.totalActive ?? 0),
          budget: Number(sm.accountBudget ?? 0),
        });
      }
      const platforms = [
        { id: 'oceanengine', name: '巨量引擎', available: true },
        { id: 'tencent', name: '腾讯广告', available: false },
        { id: 'kuaishou', name: '快手磁力', available: false },
      ];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ accounts, platforms }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  const accountMatch = url.pathname.match(/^\/api\/accounts\/([^\/]+)$/);
  if (accountMatch && (!req || req.method === 'GET')) {
    try {
      const accountId = decodeURIComponent(accountMatch[1]);
      const api = await getApiClient();
      const client = await api.createClient({ useCache: true });
      const result = await api.getProjects(client, { page: 1, pageSize: 100 });
      const projects = result.projects || [];
      const list = projects.map(p => normalizeCampaign(p, 'grouped'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        account: { id: accountId, name: ACCOUNT_NAME, platform: 'oceanengine' },
        campaigns: list,
        total: list.length,
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, campaigns: [] }));
    }
    return true;
  }

  return false;
}
