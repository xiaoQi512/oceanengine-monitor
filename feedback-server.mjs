// feedback-server.mjs — 本地 HTTP 服务 (端口 8899)
// 功能: 1. 提供 HTML 报表查看  2. 接收飞书卡片建议的 是/否 反馈
//       3. Dashboard (Alpine.js) + REST API (/api/snapshots /api/campaigns /api/alerts /api/actions)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  getLocalDate, loadSuggestionHistory, saveSuggestionHistory, recalcSummary,
  DATA_DIR, HISTORY_FILE, FEEDBACK_PORT, ACCOUNT_NAME,
  ACTION_AUDIT_FILE, ACTION_PENDING_FILE,
} from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_FILE = path.join(__dirname, 'oceanengine-report.html');
const DASHBOARD_FILE = path.join(__dirname, 'dashboard.html');
const DASHBOARD_JS = path.join(__dirname, 'dashboard.js');
const DASHBOARD_CSS = path.join(__dirname, 'dashboard.css');
const ACTION_QUEUE_FILE = path.join(__dirname, 'action-queue.json');

// ====== 动态 import api-client（避免阻塞启动；Cookie/浏览器依赖较重） ======
let _apiClient = null;
async function getApiClient() {
  if (!_apiClient) {
    _apiClient = await import('./oceanengine-api-client.mjs');
  }
  return _apiClient;
}

// ====== 静态资源 MIME ======
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// ====== 最新快照（按文件名时间序取最新） ======
function getLatestSnapshot() {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    if (files.length === 0) return null;
    const latest = files[files.length - 1];
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, latest), 'utf-8'));
  } catch (e) {
    return null;
  }
}

// ====== 最近告警（从 suggestion-history 提取最近 20 条） ======
function getRecentAlerts(limit = 20) {
  const history = loadSuggestionHistory();
  const suggestions = history.suggestions || [];
  return suggestions
    .slice(-limit)
    .reverse()
    .map(s => ({
      id: s.id,
      time: s.time,
      type: s.alertType,
      campaignId: s.campaignId,
      campaignName: s.campaignName,
      suggestion: s.suggestion,
      response: s.response || 'pending',
    }));
}

// ====== 输入校验 ======
const MAX_PARAM_LENGTH = 256;
function sanitize(str) { return String(str || '').slice(0, MAX_PARAM_LENGTH); }
function escHtml(str) { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ====== 异步写队列 (防 TOCTOU 竞态，不阻塞事件循环) ======
let writePromise = Promise.resolve();

function withWriteLock(fn) {
  const p = writePromise.then(fn).finally(() => {});
  writePromise = p;
  return p;
}

// ====== 反馈记录 ======
function recordFeedback(alertId, action, campaignId, type, name) {
  return withWriteLock(async () => {
    const history = loadSuggestionHistory();

    const existing = history.suggestions.find(s => s.id === alertId);
    if (existing) {
      existing.response = action;
      existing.responseTime = new Date().toISOString();
    } else {
      history.suggestions.push({
        id: alertId,
        time: new Date().toISOString(),
        alertType: type,
        campaignId: campaignId || '',
        campaignName: decodeURIComponent(name || ''),
        suggestion: type === 'zero_conv' ? '暂停零转化计划' : type === 'high_cpa' ? '关停高成本计划' : '执行优化操作',
        response: action,
        responseTime: new Date().toISOString(),
      });
    }

    recalcSummary(history);
    saveSuggestionHistory(history);
    return history;
  });
}

// ====== HTTP Server ======
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${FEEDBACK_PORT}`);
  
  // 健康检查
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
    return;
  }
  
  // ====== Dashboard 入口 ======
  if (url.pathname === '/') {
    res.writeHead(302, { 'Location': '/dashboard' });
    res.end();
    return;
  }

  if (url.pathname === '/dashboard') {
    try {
      if (!fs.existsSync(DASHBOARD_FILE)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body style="font-family:sans-serif;padding:40px"><h2>dashboard.html 未生成</h2></body></html>');
        return;
      }
      const html = fs.readFileSync(DASHBOARD_FILE, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500); res.end('Server Error');
    }
    return;
  }

  if (url.pathname === '/dashboard.js') {
    try {
      const js = fs.readFileSync(DASHBOARD_JS, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(js);
    } catch {
      res.writeHead(404); res.end('Not Found');
    }
    return;
  }

  // ====== Dashboard CSS ======
  if (url.pathname === '/dashboard.css') {
    try {
      const css = fs.readFileSync(DASHBOARD_CSS, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(css);
    } catch {
      res.writeHead(404); res.end('Not Found');
    }
    return;
  }

  // ====== PWA: manifest.json / sw.js ======
  if (url.pathname === '/manifest.json') {
    try {
      const f = path.join(__dirname, 'manifest.json');
      const data = fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : '{}';
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('{}');
    }
    return;
  }

  if (url.pathname === '/sw.js') {
    try {
      const f = path.join(__dirname, 'sw.js');
      const js = fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : '';
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Service-Worker-Allowed': '/',
        'Cache-Control': 'no-cache',
      });
      res.end(js);
    } catch {
      res.writeHead(404); res.end('');
    }
    return;
  }

  // vendor/alpine.min.js 本地 fallback
  if (url.pathname === '/vendor/alpine.min.js') {
    try {
      const f = path.join(__dirname, 'vendor', 'alpine.min.js');
      if (fs.existsSync(f)) {
        const js = fs.readFileSync(f, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(js);
        return;
      }
    } catch {}
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('// Alpine.js local fallback not available');
    return;
  }

  // ====== API: /api/snapshots ======
  if (url.pathname === '/api/snapshots') {
    try {
      const snap = getLatestSnapshot();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify(snap || {}));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ====== API: /api/campaigns (调 api-client.getProjects) ======
  if (url.pathname === '/api/campaigns') {
    try {
      const api = await getApiClient();
      const client = await api.createClient({ useCache: true });
      const result = await api.getProjects(client, { page: 1, pageSize: 50 });
      const projects = result.projects || [];
      // 归一化字段，便于前端渲染
      const list = projects.map(p => {
        const m = p.metrics || {};
        const statusName = p.project_status_first_name || p.project_status_name || p.status_str || p.status || '';
        // 标准化状态中文：启用中→投放中，其他保持
        let stdStatus = statusName;
        if (statusName.includes('启用')) stdStatus = '投放中';
        else if (statusName.includes('暂停')) stdStatus = '未投放(已暂停)';
        else if (statusName.includes('超出预算') || statusName.includes('预算')) stdStatus = '未投放(超出预算)';
        const spend = Number(m.stat_cost || p.stat_cost || 0);
        const leads = Number(m.attribution_all_convert_clue_count || m.clue_message_count || 0);
        const conversions = Number(m.convert_cnt || 0);
        return {
          id: String(p.id || p.campaign_id || p.project_id || ''),
          name: p.project_name || p.name || p.project_name || '',
          status: stdStatus,
          rawStatus: statusName,
          optStatus: p.opt_status,
          spend,
          conversions,
          leads,
          cpa: spend > 0 && conversions > 0 ? Number((spend / conversions).toFixed(2)) : 0,
          budget: Number(p.campaign_budget || p.budget || 0),
          bid: p.project_deep_cpa_bid || p.bid || '',
          ctr: Number(m.ctr || 0),
          cpm: Number(m.cpm_platform || 0),
          cvr: Number(m.conversion_rate || 0),
        };
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ campaigns: list, total: list.length }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, campaigns: [] }));
    }
    return;
  }

  // ====== API: /api/alerts (最近20条) ======
  if (url.pathname === '/api/alerts') {
    try {
      const alerts = getRecentAlerts(20);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ alerts }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, alerts: [] }));
    }
    return;
  }

  // ====== API: POST /api/actions (入队写操作，供 dashboard / 外部系统调用) ======
  // body: {type, campaign_id, value, source, planName?}
  //   type: 'pause' | 'stop' | 'resume' | 'adjust_budget' | 'adjust_bid'
  //   campaign_id: 计划 ID（用于反查 planName，或 worker 端直接使用）
  //   value: adjust_budget 时为金额，adjust_bid 时为出价，其他类型忽略
  //   source: 来源标识，如 'dashboard' / 'api' / 'feishu'
  //   planName: 可选，若已知可直接传入，省去反查
  // 入队 action-queue.json，格式与 feishu-listener / worker 一致
  if (url.pathname === '/api/actions' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const validTypes = ['pause', 'stop', 'resume', 'adjust_budget', 'adjust_bid'];
        if (!validTypes.includes(data.type)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `invalid type, must be one of ${validTypes.join('|')}` }));
          return;
        }
        if (!data.campaign_id && !data.planName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'campaign_id or planName required' }));
          return;
        }

        // 构造入队项（字段与 worker 期望一致）
        const item = {
          time: new Date().toISOString(),
          source: sanitize(data.source || 'dashboard'),  // [v1.1 D7] Dashboard 入口默认 source=dashboard
          by: sanitize(data.by || 'api'),
          type: data.type,
          planName: data.planName || '',     // 若空，worker 端需用 campaign_id 反查
          campaignId: sanitize(data.campaign_id || ''),
          amount: data.type === 'adjust_budget' ? Number(data.value) : null,
          bid: data.type === 'adjust_bid' ? Number(data.value) : null,
          status: 'pending',
        };

        // 入队（使用写锁防竞态，与 feishu-listener 共用 action-queue.json）
        await withWriteLock(() => {
          let q;
          try { q = JSON.parse(fs.readFileSync(ACTION_QUEUE_FILE, 'utf-8')); }
          catch { q = { actions: [] }; }
          if (!Array.isArray(q.actions)) q = { actions: [] };
          q.actions.push(item);
          fs.writeFileSync(ACTION_QUEUE_FILE, JSON.stringify(q, null, 2));
        });

        console.log(`[server] /api/actions 入队: ${item.type} plan="${item.planName}" cid=${item.campaignId}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          queued: true,
          action: item.type,
          planName: item.planName,
          campaignId: item.campaignId,
          time: item.time,
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/actions: 查看当前队列
  if (url.pathname === '/api/actions' && req.method === 'GET') {
    try {
      let q;
      try { q = JSON.parse(fs.readFileSync(ACTION_QUEUE_FILE, 'utf-8')); }
      catch { q = { actions: [] }; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify(q));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // [v1.1 D5] GET /api/pending — 待确认操作列表
  if (url.pathname === '/api/pending' && req.method === 'GET') {
    try {
      let data;
      try { data = JSON.parse(fs.readFileSync(ACTION_PENDING_FILE, 'utf-8')); }
      catch { data = { pending: [] }; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, data: data.pending || [] }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // [v1.1 D5] GET /api/audit/recent — 最近审计记录（最多 50 条）
  if (url.pathname === '/api/audit/recent' && req.method === 'GET') {
    try {
      const urlParams = new URL(req.url, 'http://localhost');
      const limit = Math.min(parseInt(urlParams.searchParams.get('limit') || '50', 10), 200);
      let lines = [];
      try {
        lines = fs.readFileSync(ACTION_AUDIT_FILE, 'utf-8')
          .split('\n')
          .filter(Boolean)
          .slice(-limit)
          .map(l => { try { return JSON.parse(l); } catch { return null; } })
          .filter(Boolean);
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, data: lines, total: lines.length }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ====== API: GET /api/live-status ======
  if (url.pathname === '/api/live-status') {
    try {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const hm = now.getHours() * 60 + now.getMinutes();
      
      function buildShifts(dateStr) {
        if (dateStr >= '2026-07-08' && dateStr <= '2026-07-10') {
          return [{start:'06:30',end:'08:30'},{start:'08:30',end:'10:30'},{start:'10:30',end:'12:30'},{start:'12:30',end:'14:30'},{start:'14:30',end:'16:30'},{start:'16:30',end:'18:30'},{start:'18:30',end:'20:30'},{start:'20:30',end:'22:30'},{start:'22:30',end:'23:30'}];
        }
        return [{start:'06:30',end:'08:30'},{start:'08:30',end:'10:30'},{start:'10:30',end:'12:30'},{start:'12:30',end:'14:30'},{start:'14:30',end:'16:30'},{start:'16:30',end:'18:30'},{start:'18:30',end:'20:30'},{start:'20:30',end:'23:30'}];
      }
      function buildAnchors(dateStr) {
        // AGENTS.md: 主播名字必须从飞书排班表读取,不能硬编码
        try {
          const cacheFile = path.join(DATA_DIR, `shifts-${dateStr}.json`);
          if (fs.existsSync(cacheFile)) {
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
            if (Array.isArray(cached.shifts)) {
              return cached.shifts.map(s => s.anchorName || '').filter(Boolean);
            }
          }
        } catch {}
        return [];
      }
      const sessions = buildShifts(today);
      const anchors = buildAnchors(today);
      
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

      const snap = getLatestSnapshot();
      const shiftData = (snap && snap.shifts) ? snap.shifts : [];
      
      const pushLog = [];
      try {
        const logFile = path.join(DATA_DIR, 'push-log.json');
        if (fs.existsSync(logFile)) {
          pushLog.push(...(JSON.parse(fs.readFileSync(logFile, 'utf-8')).entries || []).slice(-10));
        }
      } catch {}

      const accounts = [];
      if (snap && snap.accounts) {
        for (const a of snap.accounts) {
          accounts.push({
            id: a.id || a.name, name: a.name,
            spend: a.spend || 0, leads: a.leads || 0,
            cpl: a.cpl || (a.leads > 0 ? a.spend / a.leads : 0),
            activeCount: a.activeCount || 0,
          });
        }
      }

      const kpi = snap ? {
        totalSpend: snap.totalSpend || 0, liveSpend: snap.liveSpend || 0,
        videoSpend: snap.videoSpend || 0, totalLeads: snap.totalLeads || 0,
        totalConversions: snap.totalConversions || 0, avgCpl: snap.avgCpl || 0,
        liveCpl: snap.liveCpl || 0, videoCpl: snap.videoCpl || 0,
        privateMsg: snap.privateMsg || 0, dailyBudget: snap.dailyBudget || 45000,
        aiRegionsSpend: snap.aiRegionsSpend || 0,
      } : {};

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ isLive, currentAnchor, shifts, shiftData, pushLog, accounts, kpi, updatedAt: new Date().toISOString() }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }


  // ====== API: POST /api/manual-push ======
  if (url.pathname === '/api/manual-push' && req.method === 'POST') {
    try {
      const signalFile = path.join(DATA_DIR, 'manual-push-signal.json');
      fs.writeFileSync(signalFile, JSON.stringify({ timestamp: new Date().toISOString(), source: 'dashboard' }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: '推送信号已发送' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }


  // ====== API: GET /api/accounts (多账户/多平台总览) ======
  // 目前系统只接了一个真实账户（极狐-区域福利号-直播），从最新快照聚合数据。
  // 读不到快照时返回空数组但保持 200。
  if (url.pathname === '/api/accounts' && req.method === 'GET') {
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
          id: '1842681352509635',
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
    return;
  }

  // ====== API: GET /api/accounts/:id (单账户详情，返回该账户计划列表) ======
  // 计划列表等同 /api/campaigns，当前单账户场景下与全量一致；保留 account 维度便于未来扩展。
  const accountMatch = url.pathname.match(/^\/api\/accounts\/([^\/]+)$/);
  if (accountMatch && req.method === 'GET') {
    try {
      const accountId = decodeURIComponent(accountMatch[1]);
      const api = await getApiClient();
      const client = await api.createClient({ useCache: true });
      const result = await api.getProjects(client, { page: 1, pageSize: 50 });
      const projects = result.projects || [];
      const list = projects.map(p => {
        const m = p.metrics || {};
        const statusName = p.project_status_first_name || p.project_status_name || p.status_str || p.status || '';
        let stdStatus = statusName;
        if (statusName.includes('启用')) stdStatus = '投放中';
        else if (statusName.includes('暂停')) stdStatus = '未投放(已暂停)';
        else if (statusName.includes('超出预算') || statusName.includes('预算')) stdStatus = '未投放(超出预算)';
        const spend = Number(m.stat_cost || p.stat_cost || 0);
        const leads = Number(m.attribution_all_convert_clue_count || m.clue_message_count || 0);
        const conversions = Number(m.convert_cnt || 0);
        return {
          id: String(p.id || p.campaign_id || p.project_id || ''),
          name: p.project_name || p.name || p.project_name || '',
          status: stdStatus,
          rawStatus: statusName,
          optStatus: p.opt_status,
          spend,
          conversions,
          leads,
          cpa: spend > 0 && conversions > 0 ? Number((spend / conversions).toFixed(2)) : 0,
          budget: Number(p.campaign_budget || p.budget || 0),
          bid: p.project_deep_cpa_bid || p.bid || '',
          ctr: Number(m.ctr || 0),
          cpm: Number(m.cpm_platform || 0),
          cvr: Number(m.conversion_rate || 0),
        };
      });
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
    return;
  }

  // ====== 旧版报表路由（保留兼容） ======
  if (url.pathname === '/report') {
    try {
      if (!fs.existsSync(REPORT_FILE)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>📄 报表尚未生成</h2><p>等待监控脚本首次运行...</p></body></html>`);
        return;
      }
      const html = fs.readFileSync(REPORT_FILE, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Server Error');
    }
    return;
  }
  
  // 日报
  if (url.pathname === '/daily' || url.pathname.startsWith('/daily-')) {
    const today = getLocalDate();
    const dailyFile = path.join(__dirname, `oceanengine-daily-${today}.html`);
    const latestFile = path.join(__dirname, 'oceanengine-daily-latest.html');
    try {
      const file = fs.existsSync(dailyFile) ? dailyFile : (fs.existsSync(latestFile) ? latestFile : null);
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>📊 日报尚未生成</h2><p>每天23:05自动生成，届时可通过此链接查看</p></body></html>`);
        return;
      }
      const html = fs.readFileSync(file, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Server Error');
    }
    return;
  }
  
  // 建议反馈 (带输入校验)
  if (url.pathname === '/feedback') {
    const action = sanitize(url.searchParams.get('action'));
    const alertId = sanitize(url.searchParams.get('alertId'));
    const campaignId = sanitize(url.searchParams.get('campaignId'));
    const type = sanitize(url.searchParams.get('type'));
    const name = sanitize(url.searchParams.get('name'));
    
    if (!action || !['accept', 'reject'].includes(action) || alertId.length > 100) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>❌ 参数错误或过长</h2></body></html>`);
      return;
    }
    
    try {
      await recordFeedback(alertId, action, campaignId, type, name);
    } catch (e) {
      console.error('记录反馈失败:', e.message);
      // 仍返回成功页面（用户已操作，不应让其看到错误）
    }

    const actionLabel = action === 'accept' ? '✅ 已采纳' : '❌ 已拒绝';
    const suggestionLabel = type === 'zero_conv' ? '暂停零转化计划' : type === 'high_cpa' ? '关停高成本计划' : type === 'budget_cap' ? '追加预算' : '优化操作';
    
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>反馈已记录</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f7fa;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:16px;padding:48px 40px;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;max-width:420px}
.icon{font-size:48px;margin-bottom:16px}
h2{font-size:22px;color:#2c3e50;margin-bottom:8px}
p{font-size:14px;color:#64748b;margin-bottom:4px;line-height:1.6}
.note{font-size:12px;color:#94a3b8;margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9}
</style>
</head>
<body>
<div class="card">
  <div class="icon">${action === 'accept' ? '✅' : '❌'}</div>
  <h2>${actionLabel}</h2>
  <p>建议: ${suggestionLabel}</p>
  ${name ? `<p>计划: ${escHtml(decodeURIComponent(name))}</p>` : ''}
  <p style="margin-top:8px">反馈时间: ${new Date().toLocaleString('zh-CN')}</p>
  <div class="note">此反馈将影响后续建议策略 · 可关闭此页面</div>
</div>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  
  // 建议历史查看
  if (url.pathname === '/history') {
    const history = loadSuggestionHistory();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(history, null, 2));
    return;
  }
  
  // 标记忽略（由监控脚本调用）
  if (url.pathname === '/mark-ignored') {
    const alertIds = sanitize(url.searchParams.get('ids'));
    if (alertIds) {
      const ids = alertIds.split(',').map(s => s.trim()).filter(s => s.length > 0);
      const history = loadSuggestionHistory();
      for (const id of ids) {
        const existing = history.suggestions.find(s => s.id === id);
        if (existing && !existing.response) {
          existing.response = 'ignored';
          existing.responseTime = new Date().toISOString();
        }
      }
      recalcSummary(history);
      saveSuggestionHistory(history);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  
  // 404
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>404 Not Found</h2></body></html>`);
});

server.listen(FEEDBACK_PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  let lanIP = '127.0.0.1';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && (net.address.startsWith('192.168.') || net.address.startsWith('10.'))) {
        lanIP = net.address;
      }
    }
  }
  console.log(`📡 反馈服务器已启动: http://0.0.0.0:${FEEDBACK_PORT}`);
  console.log(`   Dashboard: http://127.0.0.1:${FEEDBACK_PORT}/dashboard`);
  console.log(`   本机报表: http://127.0.0.1:${FEEDBACK_PORT}/report`);
  console.log(`   局域网报表: http://${lanIP}:${FEEDBACK_PORT}/report`);
  console.log(`   历史: http://127.0.0.1:${FEEDBACK_PORT}/history`);
});

// 优雅退出
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
