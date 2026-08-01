// feedback-server.mjs — 本地 HTTP 服务 (端口 8899)
// 功能: 1. 提供 HTML 报表查看  2. 接收飞书卡片建议的 是/否 反馈
//       3. Dashboard (Alpine.js) + REST API (/api/snapshots /api/campaigns /api/alerts /api/actions)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
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
const DASHBOARD_V2_FILE = path.join(__dirname, 'dashboard-v2.html');
const DASHBOARD_V2_JS = path.join(__dirname, 'dashboard-v2.js');
const DASHBOARD_V2_CSS = path.join(__dirname, 'dashboard-v2.css');
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

// ====== 最新快照（5分钟快照，5m-前缀） ======
function get5mSnapshots(count = 1) {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => f.startsWith('5m-') && f.endsWith('.json'))
      .sort();
    if (files.length === 0) return [];
    const slice = files.slice(-count);
    return slice.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8')); }
      catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function get5mLatest() {
  const snaps = get5mSnapshots(1);
  return snaps[0] || null;
}

// ====== 计划分组工具: 投放形式分类与汇总 ======
function classifyDeliveryType(planName) {
  if (!planName) return null;
  if (planName.includes('简单投')) return '简单投';
  if (planName.includes('画面直投')) return '画面直投';
  if (planName.includes('短引直')) return '短引直';
  // 简写兜底: 历史计划名里"直投"常作为"画面直投"的简写
  if (planName.includes('直投')) return '画面直投';
  return null;
}

function emptyGroupSummary(name) {
  return { name, spend: 0, leads: 0, cpl: 0, active: 0, paused: 0, total: 0 };
}

function summarizeGroup(plans, name) {
  const total = plans.length;
  const spend = plans.reduce((s, p) => s + Number(p.spend || 0), 0);
  const leads = plans.reduce((s, p) => s + Number(p.leads || 0), 0);
  const active = plans.filter(p => p.status === '投放中').length;
  const paused = plans.filter(p => p.status && p.status.includes('暂停')).length;
  return {
    name,
    spend: Number(spend.toFixed(2)),
    leads,
    cpl: spend > 0 && leads > 0 ? Number((spend / leads).toFixed(2)) : 0,
    active,
    paused,
    total,
  };
}

// ====== AI 学习数据工具: 操作效果追踪 + 规则提取 ======
// DB 路径（与 db/writer.mjs 一致）
const DB_PATH = path.join(__dirname, 'monitor-data', 'oceanengine.db');

// [v2 fix] 统一按 UTC 解析 snapshot_time：兼容 "2026-07-31T08:55:31"（无 Z）和 "2026-07-31T08:55:01.006Z"（带 Z）
// db/writer.mjs 写入时去掉 Z，直接 new Date() 会被按本地时区解析，导致计划级效果追踪错位
function parseSnapshotTime(st) {
  if (st == null) return new Date(NaN);
  const s = String(st);
  return s.endsWith('Z') ? new Date(s) : new Date(s + 'Z');
}

// [v2 per-plan] 从 SQLite 查询计划快照（cost/leads）
// 返回离 targetTime 最近的计划快照，或 null
function queryPlanSnapshot(projectId, targetTime, toleranceMs = 15 * 60 * 1000) {
  if (!projectId) return null;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const target = parseSnapshotTime(targetTime).getTime();
    // 找 target ±toleranceMs 范围内的快照，按时间距离排序取最近
    const rows = db.prepare(`
      SELECT snapshot_time, cost, leads, conversions, ctr, cpm
      FROM snapshots
      WHERE campaign_id = ?
      ORDER BY snapshot_time DESC
      LIMIT 100
    `).all(String(projectId));
    db.close();
    if (!rows.length) return null;

    let best = null, bestDelta = Infinity;
    for (const r of rows) {
      const t = parseSnapshotTime(r.snapshot_time).getTime();
      if (isNaN(t)) continue;
      const delta = Math.abs(t - target);
      if (delta < bestDelta && delta <= toleranceMs) {
        bestDelta = delta;
        best = {
          cost: Number(r.cost) || 0,
          leads: Number(r.leads) || 0,
          conversions: Number(r.conversions) || 0,
          ctr: Number(r.ctr) || 0,
          cpm: Number(r.cpm) || 0,
          time: r.snapshot_time,
        };
      }
    }
    return best;
  } catch (e) {
    console.warn('[ai] 计划快照查询失败:', e.message);
    return null;
  }
}

// [v2 per-plan] 计划级效果评估
// 比较操作前后该计划自身的 cost/leads 变化
// 阈值: 单计划 15 分钟正常消耗约 20-80 元，pause 后应 < 5 元
function computePlanEffect(audit) {
  const projectId = audit.projectId;
  if (!projectId) return null;

  const beforePlan = queryPlanSnapshot(projectId, audit.time, 10 * 60 * 1000);
  if (!beforePlan) return null;
  const afterPlan = queryPlanSnapshot(projectId,
    new Date(new Date(audit.time).getTime() + 15 * 60 * 1000).toISOString(),
    15 * 60 * 1000);
  // 找不到 after 快照 -> 返回 null，让账户级 fallback 介入
  if (!afterPlan) return null;

  const deltaCost = Number((afterPlan.cost - beforePlan.cost).toFixed(2));
  const deltaLeads = afterPlan.leads - beforePlan.leads;
  const deltaConv = afterPlan.conversions - beforePlan.conversions;

  // 计划级阈值（单计划 15 分钟正常消耗约 20-80 元）
  let impactRating = 'neutral';
  const at = audit.actionType;
  if (at === 'pause' || at === 'stop') {
    if (deltaCost < 5) impactRating = 'high_positive';      // plan 几乎停止消耗
    else if (deltaCost < 20) impactRating = 'positive';      // 显著降低
    else if (deltaCost < 50) impactRating = 'neutral';       // 轻微降低
    else impactRating = 'negative';                          // 消耗未降继续增长
  } else if (at === 'resume' || at === 'adjust_budget') {
    if (deltaCost > 30) impactRating = 'positive';           // 消耗恢复/上升
    else if (deltaCost > 10) impactRating = 'neutral';
    else impactRating = 'negative';
  } else if (at === 'adjust_bid') {
    // 改出价主要看 CPM 变化（降出价期望 CPM 降低）
    const deltaCpm = Number(((afterPlan.cpm || 0) - (beforePlan.cpm || 0)).toFixed(2));
    if (deltaCpm < -5) impactRating = 'positive';
    else if (deltaCpm < 5) impactRating = 'neutral';
    else impactRating = 'negative';
  }

  return {
    status: 'evaluated',
    level: 'plan',
    beforePlan: { cost: beforePlan.cost, leads: beforePlan.leads, cpm: beforePlan.cpm, time: beforePlan.time },
    afterPlan: { cost: afterPlan.cost, leads: afterPlan.leads, cpm: afterPlan.cpm, time: afterPlan.time },
    deltaCost15min: deltaCost,
    deltaLeads15min: deltaLeads,
    deltaConv15min: deltaConv,
    impactRating,
  };
}

// 读取 action-audit.jsonl，对每条记录计算 effect（找操作时间 +N 分钟的快照对比 before）
// [v2 fix] 5m 快照文件索引缓存：避免每次调用 readdirSync 扫描 2000+ 文件（AI 学习接口性能优化）
let _snapFileIndex = null;
let _snapFileIndexAt = 0;
function getSnapFileIndex(maxAgeMs = 60 * 1000) {
  const now = Date.now();
  if (_snapFileIndex && now - _snapFileIndexAt < maxAgeMs) return _snapFileIndex;
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith('5m-') && f.endsWith('.json'))
    .sort();
  _snapFileIndex = files.map(f => {
    const raw = f.replace(/^5m-/, '').replace(/\.json$/, '');
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const isoLike = match[1] + 'T' + match[2] + ':' + match[3] + ':' + match[4];
    const t = new Date(isoLike).getTime();
    if (isNaN(t)) return null;
    return { file: f, isoLike, t };
  }).filter(Boolean);
  _snapFileIndexAt = now;
  return _snapFileIndex;
}

function findSnapshotAround(targetTime, toleranceMs = 6 * 60 * 1000) {
  // 在 targetTime ±toleranceMs 范围内找最近的 5m 快照
  try {
    const target = new Date(targetTime).getTime();
    let best = null, bestDelta = Infinity;
    for (const entry of getSnapFileIndex()) {
      const delta = Math.abs(entry.t - target);
      if (delta < bestDelta && delta <= toleranceMs) {
        bestDelta = delta;
        best = entry;
      }
    }
    if (!best) return null;
    const snap = JSON.parse(fs.readFileSync(path.join(DATA_DIR, best.file), 'utf-8'));
    return {
      accountSpend: Number(snap.accountSpend) || 0,
      totalConv: Number(snap.totalConv) || 0,
      time: snap.time || best.isoLike,
      file: best.file,
    };
  } catch { return null; }
}

// [v2 fix] DB 版快照查找：从 SQLite 聚合账户级指标，替代全量扫描 5m JSON 文件（AI 学习接口性能优化）
function findSnapshotAroundDB(targetTime, toleranceMs = 6 * 60 * 1000) {
  try {
    const target = parseSnapshotTime(targetTime).getTime();
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const rows = db.prepare(`
        SELECT snapshot_time,
          SUM(cost) as accountSpend,
          SUM(conversions) as totalConv
        FROM snapshots
        WHERE source_type = '5min'
        GROUP BY snapshot_time
      `).all();
      let best = null, bestDelta = Infinity;
      for (const r of rows) {
        const t = parseSnapshotTime(r.snapshot_time).getTime();
        if (isNaN(t)) continue;
        const delta = Math.abs(t - target);
        if (delta < bestDelta && delta <= toleranceMs) {
          bestDelta = delta;
          best = {
            accountSpend: Number(r.accountSpend) || 0,
            totalConv: Number(r.totalConv) || 0,
            time: r.snapshot_time,
          };
        }
      }
      return best;
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn('[ai] DB 快照查找失败:', e.message);
    return null;
  }
}

function computeActionEffect(audit) {
  // [v2] 优先用计划级评估（DB per-plan 快照），fallback 到账户级
  const planResult = computePlanEffect(audit);
  if (planResult) return planResult;

  // === 以下为账户级 fallback（旧逻辑） ===
  let before = audit.snapshotBefore;
  if (!before) {
    const fallback = findSnapshotAroundDB(audit.time) || findSnapshotAround(audit.time);
    if (!fallback) return { status: 'pending', reason: 'no_snapshot_before' };
    before = { accountSpend: fallback.accountSpend, totalConv: fallback.totalConv, time: fallback.time };
  }
  // 找操作后 15 分钟的快照（DB 优先，文件兜底）
  const opTime = new Date(audit.time).getTime();
  const afterTarget = new Date(opTime + 15 * 60 * 1000).toISOString();
  const after15 = findSnapshotAroundDB(afterTarget, 6 * 60 * 1000) || findSnapshotAround(afterTarget, 6 * 60 * 1000);
  if (!after15) return { status: 'pending', reason: 'no_snapshot_after' };

  const deltaSpend = Number((after15.accountSpend - before.accountSpend).toFixed(2));
  const deltaConv = after15.totalConv - before.totalConv;
  // 注意: deltaSpend 是账户总消耗变化，pause 单个计划后其他计划仍在消耗
  // 阈值参考: 正常账户 15 分钟消耗约 500-1500 元；pause 后显著降低才算 positive
  let impactRating = 'neutral';
  if (audit.actionType === 'pause' || audit.actionType === 'stop') {
    if (deltaSpend < 200) impactRating = 'high_positive';      // 几乎停消耗
    else if (deltaSpend < 600) impactRating = 'positive';       // 显著降低
    else if (deltaSpend < 1000) impactRating = 'neutral';       // 轻微降低
    else impactRating = 'negative';                             // 消耗未降反升
  } else if (audit.actionType === 'resume' || audit.actionType === 'adjust_budget') {
    if (deltaSpend > 1500) impactRating = 'positive';           // 消耗显著上升
    else if (deltaSpend > 800) impactRating = 'neutral';
    else impactRating = 'negative';
  }
  return {
    status: 'evaluated',
    level: 'account',
    deltaSpend15min: deltaSpend,
    deltaConv15min: deltaConv,
    impactRating,
    beforeSnapshot: before,
    afterSnapshot: { accountSpend: after15.accountSpend, totalConv: after15.totalConv, time: after15.time },
  };
}

// [v2] AI 异常计划判定阈值（消耗/CPA 口径，按需调整）
const ANOMALY_MIN_SPEND = 500;
const ANOMALY_MAX_CPA = 150;

function extractRules(events, minEvidence = 2) {
  const groups = {};
  for (const e of events) {
    if (!e.effect || e.effect.status !== 'evaluated') continue;
    if (!e.actionType) continue;  // 跳过无 actionType 的记录
    const deliveryType = classifyDeliveryType(e.planName) || '其他';
    const key = `${deliveryType}:${e.actionType}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  }
  const rules = [];
  for (const [key, evts] of Object.entries(groups)) {
    if (evts.length < minEvidence) continue;
    const [deliveryType, action] = key.split(':');
    const positiveEvts = evts.filter(e => e.effect.impactRating.includes('positive'));
    const successRate = positiveEvts.length / evts.length;
    const avgDeltaCost = evts.reduce((s, e) => s + Number(e.effect.deltaCost15min ?? e.effect.deltaSpend15min ?? 0), 0) / evts.length;
    rules.push({
      id: `R-${rules.length + 1}`,
      deliveryType,
      action,
      condition: extractConditionRange(evts),
      confidence: Number(Math.min(evts.length / 10, successRate * (1 + evts.length / 20)).toFixed(2)),
      evidence: evts.length,
      successRate: Number(successRate.toFixed(2)),
      avgDeltaCost15min: Number(avgDeltaCost.toFixed(2)),
      // 评估级别：plan 表示用计划级数据，account 表示用账户级
      evalLevel: evts[0]?.effect?.level || 'account',
      examples: evts.slice(-3).map(e => ({ planName: e.planName, time: e.time, effect: e.effect.impactRating })),
    });
  }
  return rules.sort((a, b) => b.confidence - a.confidence);
}

function extractConditionRange(evts) {
  // 从历史事件的 beforeValue 提取共性范围
  const budgets = evts.map(e => Number(e.beforeValue?.budget || 0)).filter(b => b > 0);
  const statuses = evts.map(e => e.beforeValue?.status).filter(Boolean);
  return {
    budgetRange: budgets.length ? { min: Math.min(...budgets), max: Math.max(...budgets) } : null,
    commonStatus: statuses.length ? [...new Set(statuses)] : [],
  };
}

// ====== 旧格式最新快照（按文件名时间序取最新） ======
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

  // ====== Dashboard v2 (新版仪表盘，与 v1 并存，/dashboard 仍指 v1) ======
  if (url.pathname === '/dashboard-v2') {
    try {
      const html = fs.existsSync(DASHBOARD_V2_FILE)
        ? fs.readFileSync(DASHBOARD_V2_FILE, 'utf-8')
        : '<html><body><h2>dashboard-v2.html 尚未创建</h2></body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500); res.end('Server Error: ' + e.message);
    }
    return;
  }
  if (url.pathname === '/dashboard-v2.js') {
    try {
      const js = fs.existsSync(DASHBOARD_V2_JS) ? fs.readFileSync(DASHBOARD_V2_JS, 'utf-8') : '';
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(js);
    } catch {
      res.writeHead(404); res.end('Not Found');
    }
    return;
  }
  if (url.pathname === '/dashboard-v2.css') {
    try {
      const css = fs.existsSync(DASHBOARD_V2_CSS) ? fs.readFileSync(DASHBOARD_V2_CSS, 'utf-8') : '';
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

  // vendor/chart.umd.min.js 本地 fallback
  if (url.pathname === '/vendor/chart.umd.min.js') {
    try {
      const f = path.join(__dirname, 'vendor', 'chart.umd.min.js');
      if (fs.existsSync(f)) {
        const js = fs.readFileSync(f, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(js);
        return;
      }
    } catch {}
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('// Chart.js local fallback not available');
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

  // ====== API: /api/snapshots/5m (最新 + 最近12个5分钟快照) ======
  // 返回 { latest: {...}, history: [...最近12个] }
  if (url.pathname === '/api/snapshots/5m') {
    try {
      // [v2 fix] 默认只返回最新快照；需要历史时用 ?history=N（前端轮询仅用 latest，减少带宽）
      const historyN = Math.max(0, parseInt(url.searchParams.get('history') || '0', 10) || 0);
      const snaps = get5mSnapshots(historyN > 0 ? historyN : 1);
      const latest = snaps.length ? snaps[snaps.length - 1] : null;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ latest, history: historyN > 0 ? snaps : [] }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, latest: null, history: [] }));
    }
    return;
  }

  // ====== API: /api/snapshots/trend (近1小时趋势，聚合为前端折线图所需格式) ======
  // 返回 { labels, spend(累计), cpl, cpm, conversions(累计), impressions(累计),
  //         activeCount, planSpend, spendingCount,
  //         convBreakdown:[{msgLead,formSubmit,other}], top5PerPoint:[[{name,spend,cpl}]] }
  if (url.pathname === '/api/snapshots/trend') {
    try {
      const POINTS = 12;
      let db = null;
      try { db = new Database(DB_PATH, { readonly: true }); } catch {}

      const labels = [], spend = [], cpl = [], cpm = [], conversions = [], impressions = [];
      const timestamps = [];
      const activeCount = [], planSpend = [], spendingCount = [], deliveringCount = [];
      const convBreakdown = [], top5PerPoint = [];

      if (db) {
        // Step 1: 取最近 12 个 distinct 5min 快照时间
        const dbTimes = db.prepare(`
          SELECT snapshot_time FROM snapshots
          WHERE source_type = '5min'
          GROUP BY snapshot_time
          ORDER BY snapshot_time DESC LIMIT ?
        `).all(POINTS);
        // 按时间升序
        dbTimes.reverse();

        // Step 2: 生成严格 5 分钟整点网格，forward fill 缺失点
        // snapshot_time 统一为 UTC 无 Z 秒级（如 "2026-07-31T08:55:31"），parseSnapshotTime 兼容带 Z 旧数据
        const latestTime = dbTimes.length
          ? parseSnapshotTime(dbTimes[dbTimes.length - 1].snapshot_time)
          : new Date();
        const normTime = new Date(latestTime);
        normTime.setSeconds(0, 0);
        normTime.setMinutes(Math.floor(normTime.getMinutes() / 5) * 5);
        const timeMap = new Map();
        for (const row of dbTimes) {
          const t = parseSnapshotTime(row.snapshot_time);
          const mins = Math.floor(t.getMinutes() / 5) * 5;
          const key = `${String(t.getHours()).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
          timeMap.set(key, row.snapshot_time);
        }
        const filledTimes = [];
        let lastValid = null;
        for (let i = POINTS - 1; i >= 0; i--) {
          const pt = new Date(normTime.getTime() - i * 5 * 60 * 1000);
          const key = `${String(pt.getHours()).padStart(2, '0')}:${String(pt.getMinutes()).padStart(2, '0')}`;
          const st = timeMap.get(key);
          if (st) { filledTimes.push(st); lastValid = st; }
          else if (lastValid) filledTimes.push(lastValid);
          else filledTimes.push(null);
        }

        // 预编译语句
        let prevTimeStmt = null, top5DeltaStmt = null;
        try {
          prevTimeStmt = db.prepare(`SELECT snapshot_time FROM snapshots WHERE source_type = '5min' AND snapshot_time < ? ORDER BY snapshot_time DESC LIMIT 1`);
          top5DeltaStmt = db.prepare(`SELECT s.campaign_id, c.name,
            s.cost - COALESCE(prev.cost, 0) as delta_cost,
            s.leads - COALESCE(prev.leads, 0) as delta_leads,
            s.cost as curr_cost,
            prev.cost as prev_cost,
            prev.cost - COALESCE(prevPrev.cost, 0) as prev_delta_cost
            FROM snapshots s
            LEFT JOIN snapshots prev ON s.campaign_id = prev.campaign_id AND prev.snapshot_time = @prevTime AND prev.source_type = '5min'
            LEFT JOIN snapshots prevPrev ON s.campaign_id = prevPrev.campaign_id AND prevPrev.snapshot_time = @prevPrevTime AND prevPrev.source_type = '5min'
            LEFT JOIN campaigns c ON s.campaign_id = c.campaign_id
            WHERE s.snapshot_time = @currTime AND s.source_type = '5min'
            ORDER BY delta_cost DESC LIMIT 5`);
        } catch {}

        // 生成 labels（始终严格 5min 间隔，即使某些点被 forward fill）
        for (let i = 0; i < POINTS; i++) {
          const pt = new Date(normTime.getTime() - (POINTS - 1 - i) * 5 * 60 * 1000);
          labels.push(`${String(pt.getHours()).padStart(2, '0')}:${String(pt.getMinutes()).padStart(2, '0')}`);
          timestamps.push(pt.toISOString());
        }

        for (const st of filledTimes) {
          // forward fill: 如果当前点 forward fill 到同一个 st，跳过（避免重复 label）
          if (!st) {
            // 完全无数据：填 0
            spend.push(0); cpl.push(0); cpm.push(0); conversions.push(0); impressions.push(0);
            activeCount.push(0); planSpend.push(0); spendingCount.push(0); deliveringCount.push(0);
            convBreakdown.push({ msgLead: 0, formSubmit: 0, other: 0 });
            top5PerPoint.push([]);
            continue;
          }
          const t = parseSnapshotTime(st);

          // Step 3: 聚合该时刻的所有 plan 数据（status 直接从 snapshots 表读取）
          const agg = db.prepare(`
            SELECT COALESCE(SUM(cost), 0) as totalCost,
              COALESCE(SUM(leads), 0) as totalLeads,
              COALESCE(SUM(conversions), 0) as totalConv,
              COUNT(DISTINCT campaign_id) as campaignCount,
              COUNT(DISTINCT CASE WHEN cost > 0 THEN campaign_id END) as spendingCount,
              COUNT(DISTINCT CASE WHEN status IN ('投放中','启用中','启用') THEN campaign_id END) as deliveringCount,
              COALESCE(SUM(msg_lead), 0) as msgLead,
              COALESCE(SUM(form_submit), 0) as formSubmit
            FROM snapshots
            WHERE snapshot_time = ? AND source_type = '5min'
          `).get(st);

          const aggCost = Number(agg?.totalCost || 0);
          const aggLeads = Number(agg?.totalLeads || 0);
          const aggConv = Number(agg?.totalConv || 0);
          spend.push(Number(aggCost.toFixed(2)));
          cpl.push(aggCost > 0 && aggConv > 0 ? Number((aggCost / aggConv).toFixed(2)) : 0);
          // CPM: 消耗加权调和平均 = SUM(cost) / SUM(cost/cpm)，数学等价于总消耗/总展示量*1000
          // 同时从 cpm 反算 impressions = SUM(cost/cpm * 1000)，供前端 delta 模式使用
          const cpmRow = db.prepare(`
            SELECT
              COALESCE(SUM(cost), 0) as totalCostForCpm,
              COALESCE(SUM(CASE WHEN cpm > 0 AND cost > 0 THEN cost / cpm END), 0) as sumCostDivCpm,
              COALESCE(SUM(CASE WHEN cpm > 0 AND cost > 0 THEN cost / cpm * 1000 END), 0) as totalImpr
            FROM snapshots
            WHERE snapshot_time = ? AND source_type = '5min' AND cpm > 0 AND cost > 0
          `).get(st);
          const tCost = Number(cpmRow?.totalCostForCpm || 0);
          const tSum = Number(cpmRow?.sumCostDivCpm || 0);
          const tImpr = Math.round(Number(cpmRow?.totalImpr || 0));
          const weightedCpm = tSum > 0 ? Number((tCost / tSum).toFixed(2)) : 0;
          cpm.push(weightedCpm);
          conversions.push(aggConv);
          impressions.push(tImpr);  // 从 cpm 反算的展示量，支持前端 delta 模式 CPM 计算

          activeCount.push(Number(agg?.campaignCount || 0));
          planSpend.push(Number(aggCost.toFixed(2)));
          spendingCount.push(Number(agg?.spendingCount || 0));
          deliveringCount.push(Number(agg?.deliveringCount || 0));

          // 转化分类
          convBreakdown.push({
            msgLead: Number(agg?.msgLead || 0),
            formSubmit: Number(agg?.formSubmit || 0),
            other: Math.max(0, aggConv - Number(agg?.msgLead || 0) - Number(agg?.formSubmit || 0)),
          });

          // Step 3: TOP5 增量 (当前时刻 vs 上��个 5min 时刻的 delta)
          try {
            const prevT = prevTimeStmt ? prevTimeStmt.get(st) : null;
            const prevPrevT = prevT?.snapshot_time ? prevTimeStmt.get(prevT.snapshot_time) : null;
            const top5 = top5DeltaStmt
              ? top5DeltaStmt.all({ prevTime: prevT?.snapshot_time || null, prevPrevTime: prevPrevT?.snapshot_time || null, currTime: st })
                .filter(r => (r.delta_cost || 0) > 0)
                .map(r => {
                  const deltaCost = Number(r.delta_cost || 0);
                  const deltaLeads = Number(r.delta_leads || 0);
                  const prevCost = Number(r.prev_cost || 0);
                  const prevDeltaCost = Number(r.prev_delta_cost || 0);
                  let trend = '';
                  if (prevCost < 0.01) trend = 'NEW';
                  else if (deltaCost > prevDeltaCost * 1.5) trend = '起量';
                  else if (deltaCost < prevDeltaCost * 0.5) trend = '掉量';
                  else trend = '稳定';
                  // [v2 fix] 以上一个 5 分钟增量（prev_delta_cost）为基准：趋势阈值对比增量而非累计值
                  const changeRate = prevDeltaCost > 0.01 ? Number((deltaCost / prevDeltaCost).toFixed(2)) : null;
                  return {
                    name: (r.name || r.campaign_id || '').slice(0, 30),
                    spend: Number(deltaCost.toFixed(2)),
                    cpl: deltaLeads > 0 ? Number((deltaCost / deltaLeads).toFixed(2)) : 0,
                    leads: deltaLeads,
                    trend,
                    changeRate,
                  };
                })
              : [];
            top5PerPoint.push(top5);
          } catch { top5PerPoint.push([]); }
        }
      }

      if (db) { try { db.close(); } catch {} }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      // 提取最新时间点的总数和暂停数（与趋势图 activeCount/spendingCount 同源）
      const totalPlanCount = activeCount.length ? activeCount[activeCount.length - 1] : 0;
      const pausedPlanCount = spendingCount.length ? Math.max(0, (activeCount[activeCount.length - 1] || 0) - (spendingCount[spendingCount.length - 1] || 0)) : 0;
      res.end(JSON.stringify({ labels, timestamps, spend, cpl, cpm, conversions, impressions, activeCount, planSpend, spendingCount, deliveringCount, totalPlanCount, pausedPlanCount, convBreakdown, top5PerPoint }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, labels: [], timestamps: [], spend: [], cpl: [], cpm: [], conversions: [], impressions: [], activeCount: [], planSpend: [], spendingCount: [], deliveringCount: [], totalPlanCount: 0, pausedPlanCount: 0, convBreakdown: [], top5PerPoint: [] }));
    }
    return;
  }

  // ====== API: /api/campaigns (调 api-client.getProjects) ======
  if (url.pathname === '/api/campaigns') {
    try {
      const api = await getApiClient();
      const client = await api.createClient({ useCache: true });
      const result = await api.getProjects(client, { page: 1, pageSize: 100 });
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
          budget: numOf(p.campaign_budget ?? p.budget),
          bid: p.project_deep_cpa_bid || p.bid || '',
          ctr: numOf(m.ctr),
          cpm: numOf(m.cpm_platform),
          cvr: numOf(m.conversion_rate),
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

  // ====== API: /api/campaigns/grouped (按投放形式分组的计划列表) ======
  // 返回 { groups:{ 简单投/画面直投/短引直: { summary, plans } }, ungrouped:[...], totalSummary:{...} }
  if (url.pathname === '/api/campaigns/grouped') {
    try {
      const api = await getApiClient();
      const client = await api.createClient({ useCache: true });
      const result = await api.getProjects(client, { page: 1, pageSize: 100 });
      const projects = result.projects || [];
      const numOf = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
      const list = projects.map(p => {
        const m = p.metrics || {};
        const statusName = p.project_status_first_name || p.project_status_name || p.status_str || p.status || '';
        let stdStatus = statusName;
        if (statusName.includes('启用')) stdStatus = '投放中';
        else if (statusName.includes('暂停')) stdStatus = '未投放(已暂停)';
        else if (statusName.includes('超出预算') || statusName.includes('预算')) stdStatus = '未投放(超出预算)';
        const spend = numOf(m.stat_cost ?? p.stat_cost);
        const leads = numOf(m.attribution_all_convert_clue_count ?? m.clue_message_count);
        const conversions = numOf(m.convert_cnt);
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
      // 分类: 简单投 / 画面直投 / 短引直 / 其他
      const GROUPS = ['简单投', '画面直投', '短引直'];
      const groups = {};
      for (const g of GROUPS) groups[g] = { summary: emptyGroupSummary(g), plans: [] };
      const ungrouped = [];
      for (const p of list) {
        const g = classifyDeliveryType(p.name);
        if (g && groups[g]) groups[g].plans.push(p);
        else ungrouped.push(p);
      }
      for (const g of GROUPS) groups[g].summary = summarizeGroup(groups[g].plans, g);
      const totalSummary = summarizeGroup(list, '全部');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ groups, ungrouped, totalSummary }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, groups: {}, ungrouped: [], totalSummary: {} }));
    }
    return;
  }

  // ====== API: /api/ai/learning-data (AI 学习数据 + 规则 + 最近操作效果) ======
  if (url.pathname === '/api/ai/learning-data') {
    try {
      // 读取审计
      const auditFile = ACTION_AUDIT_FILE;
      const raw = fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf-8') : '';
      const lines = raw.split('\n').filter(Boolean);
      // 最近 50 条，按时间倒序
      const recentAudits = lines.slice(-50).reverse().map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);

      // 为每条审计计算 effect
      const eventsWithEffect = recentAudits.map(a => ({
        ...a,
        effect: computeActionEffect(a),
      }));

      // 提取规则
      const rules = extractRules(eventsWithEffect);

      // 当前异常计划（从最新 campaigns 数据判断）
      let anomalies = [];
      try {
        const api = await getApiClient();
        const client = await api.createClient({ useCache: true });
        const result = await api.getProjects(client, { page: 1, pageSize: 100 });
        const projects = result.projects || [];
        anomalies = projects.map(p => {
          const m = p.metrics || {};
          const spend = Number(m.stat_cost || 0);
          const leads = Number(m.attribution_all_convert_clue_count || 0);
          const cpa = spend > 0 && leads > 0 ? spend / leads : 0;
          return {
            id: String(p.id || ''),
            name: p.project_name || '',
            spend, leads, cpa: Number(cpa.toFixed(2)),
            status: p.project_status_first_name || p.status_str || '',
            deliveryType: classifyDeliveryType(p.project_name || '') || '其他',
          };
        }).filter(p => {
          // 异常条件：消耗 > ANOMALY_MIN_SPEND 且 (CPA > ANOMALY_MAX_CPA 或 leads=0)
          if (p.spend < ANOMALY_MIN_SPEND) return false;
          if (p.leads === 0) return true;
          if (p.cpa > ANOMALY_MAX_CPA) return true;
          return false;
        });
      } catch (e) {
        // API 失败不阻塞 AI 数据返回
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        rules,
        recentActions: eventsWithEffect.slice(0, 20),
        anomalies,
        summary: {
          totalAudits: lines.length,
          evaluatedActions: eventsWithEffect.filter(e => e.effect?.status === 'evaluated').length,
          rulesCount: rules.length,
        },
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, rules: [], recentActions: [], anomalies: [] }));
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

  // [v1.1 D5] GET /api/audit/recent — 最近审计记录（最多 200 条）
  if (url.pathname === '/api/audit/recent' && req.method === 'GET') {
    try {
      const urlParams = new URL(req.url, 'http://localhost');
      const raw = parseInt(urlParams.searchParams.get('limit') || '50', 10);
      const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 50;
      let lines = [];
      try {
        // [v1.1 P1-fix] 流式读取末尾，避免大文件全量加载阻塞 server
        const content = fs.readFileSync(ACTION_AUDIT_FILE, 'utf-8');
        lines = content
          .split('\n')
          .filter(Boolean)
          .slice(-limit)
          .map(l => { try { return JSON.parse(l); } catch { return null; } })
          .filter(Boolean);
      } catch (e) {
        // [v1.1 P1-fix] 记录日志而非静默吞掉
        if (e.code !== 'ENOENT') console.error('[audit-read]', e.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, data: lines, total: lines.length }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // [v1.1 P2] POST /api/actions/rollback — 基于审计记录 beforeValue 反向入队
  // body: { traceRef } 或 { time, planName } 用于定位审计记录
  // 找到审计记录后，根据 actionType 和 beforeValue 构造反向操作入队
  if (url.pathname === '/api/actions/rollback' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        // [v1.1 P2-fix] 读取审计日志查找目标记录（限制最近 500 条，避免大文件阻塞）
        let auditLines = [];
        try {
          auditLines = fs.readFileSync(ACTION_AUDIT_FILE, 'utf-8')
            .split('\n')
            .filter(Boolean)
            .slice(-500)
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(Boolean);
        } catch (e) {
          if (e.code !== 'ENOENT') console.error('[audit-read]', e.message);
        }

        // 定位审计记录：优先 traceRef，否则 time+planName
        let record = null;
        if (data.traceRef) {
          record = auditLines.find(r => r.traceRef === data.traceRef);
        } else if (data.time && data.planName) {
          record = auditLines.find(r => r.time === data.time && r.planName === data.planName);
        } else {
          // 取最近一条成功的可回滚记录
          record = [...auditLines].reverse().find(r =>
            r.result?.ok === true &&
            ['pause', 'stop', 'resume', 'adjust_budget', 'adjust_bid'].includes(r.actionType)
          );
        }

        if (!record) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: '未找到可回滚的审计记录' }));
          return;
        }

        // [v1.1 P2-fix] beforeValue 校验按操作类型区分：
        // pause/stop/resume 不需要 beforeValue（直接反向）；adjust_budget/adjust_bid 需要
        const bv = record.beforeValue || {};

        // 根据 actionType + beforeValue 构造反向操作
        let rollbackAction = null;
        switch (record.actionType) {
          case 'pause':
          case 'stop':
            rollbackAction = { type: 'resume', planName: record.planName };
            break;
          case 'resume':
            rollbackAction = { type: 'pause', planName: record.planName };
            break;
          case 'adjust_budget':
            if (bv.budget == null && typeof bv !== 'number') {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: '审计记录缺少 beforeValue.budget，无法回滚预算' }));
              return;
            }
            rollbackAction = { type: 'adjust_budget', planName: record.planName, amount: bv.budget ?? bv };
            break;
          case 'adjust_bid':
            if (bv.bid == null && typeof bv !== 'number') {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: '审计记录缺少 beforeValue.bid，无法回滚出价' }));
              return;
            }
            rollbackAction = { type: 'adjust_bid', planName: record.planName, bid: bv.bid ?? bv };
            break;
          default:
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: '不支持回滚的操作类型: ' + record.actionType }));
            return;
        }

        // [v1.1 P2-fix] 金额/出价有效性校验（两类都校验）
        if (rollbackAction.type === 'adjust_budget' && (!rollbackAction.amount || rollbackAction.amount <= 0)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'beforeValue 预算值无效，无法回滚' }));
          return;
        }
        if (rollbackAction.type === 'adjust_bid' && (!rollbackAction.bid || rollbackAction.bid <= 0)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'beforeValue 出价值无效，无法回滚' }));
          return;
        }

        // 入队
        const item = {
          time: new Date().toISOString(),
          source: 'dashboard',
          by: sanitize(data.by || 'dashboard-rollback'),
          type: rollbackAction.type,
          planName: rollbackAction.planName,
          campaignId: '',
          amount: rollbackAction.amount ?? null,
          bid: rollbackAction.bid ?? null,
          status: 'pending',
          rollbackOf: record.time,  // 标记回滚来源
        };

        await withWriteLock(() => {
          let q;
          try { q = JSON.parse(fs.readFileSync(ACTION_QUEUE_FILE, 'utf-8')); }
          catch { q = { actions: [] }; }
          if (!Array.isArray(q.actions)) q = { actions: [] };
          q.actions.push(item);
          fs.writeFileSync(ACTION_QUEUE_FILE, JSON.stringify(q, null, 2));
        });

        console.log(`[server] /api/actions/rollback 入队: ${item.type} plan="${item.planName}" (回滚 ${record.time})`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          queued: true,
          rollbackAction: item.type,
          planName: item.planName,
          originalRecord: { time: record.time, actionType: record.actionType, beforeValue: record.beforeValue },
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ====== API: GET /api/live-status ======
  if (url.pathname === '/api/live-status') {
    try {
      const now = new Date();
      const today = getLocalDate();  // 用本地日期（北京+8），而非 UTC
      const hm = now.getHours() * 60 + now.getMinutes();
      
      function buildShifts(dateStr) {
        // 优先从飞书同步的缓存文件读取时段（与 buildAnchors 同源，保证 1:1 对齐）
        try {
          const cacheFile = path.join(DATA_DIR, `shifts-${dateStr}.json`);
          if (fs.existsSync(cacheFile)) {
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
            if (Array.isArray(cached.shifts) && cached.shifts.length > 0) {
              return cached.shifts.map(s => {
                // label 格式: "05:30-7:30" -> {start:"05:30", end:"07:30"}
                const parts = (s.label || '').split('-');
                if (parts.length !== 2) return null;
                return { start: parts[0].trim(), end: parts[1].trim() };
              }).filter(Boolean);
            }
          }
        } catch {}
        // 兜底: 硬编码时段
        if (dateStr >= '2026-07-08' && dateStr <= '2026-07-10') {
          return [{start:'06:30',end:'08:30'},{start:'08:30',end:'10:30'},{start:'10:30',end:'12:30'},{start:'12:30',end:'14:30'},{start:'14:30',end:'16:30'},{start:'16:30',end:'18:30'},{start:'18:30',end:'20:30'},{start:'20:30',end:'22:30'},{start:'22:30',end:'23:30'}];
        }
        return [{start:'06:30',end:'08:30'},{start:'08:30',end:'10:30'},{start:'10:30',end:'12:30'},{start:'12:30',end:'14:30'},{start:'14:30',end:'16:30'},{start:'16:30',end:'18:30'},{start:'18:30',end:'20:30'},{start:'20:30',end:'23:30'}];
      }
      function buildAnchors(dateStr) {
        // AGENTS.md: 主播名字必须从飞书排班表读取,不能硬编码
        // 不做 filter(Boolean)，保证与 buildShifts 返回数量 1:1 对齐
        try {
          const cacheFile = path.join(DATA_DIR, `shifts-${dateStr}.json`);
          if (fs.existsSync(cacheFile)) {
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
            if (Array.isArray(cached.shifts)) {
              return cached.shifts.map(s => s.anchorName || '待定');
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

  // ====== API: POST /api/repush (仪表盘单条补推) ======
  if (url.pathname === '/api/repush' && req.method === 'POST') {
    try {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { type } = JSON.parse(body || '{}');
          const signalFile = path.join(DATA_DIR, 'repush-signal.json');
          fs.writeFileSync(signalFile, JSON.stringify({
            type: type || 'unknown',
            timestamp: new Date().toISOString(),
            source: 'dashboard-repush',
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: '补推信号已入队', type: type || 'unknown' }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: '无效请求' }));
        }
      });
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
      const result = await api.getProjects(client, { page: 1, pageSize: 100 });
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
