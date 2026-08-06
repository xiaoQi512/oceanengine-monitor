// tests/http-routes.test.mjs - http-routes 模块单元测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { serveStatic } from '../src/services/http-routes/static.mjs';
import { serveSnapshots } from '../src/services/http-routes/api-snapshots.mjs';
import { serveSnapshotTrend } from '../src/services/http-routes/api-snapshots-trend.mjs';
import {
  applySessionSpend,
  getSessionSpendRows,
  resolveSessionWindow,
  serveCampaigns,
} from '../src/services/http-routes/api-campaigns.mjs';
import { serveAlerts } from '../src/services/http-routes/api-alerts.mjs';
import { serveLiveStatus } from '../src/services/http-routes/api-live.mjs';
import { serveAccounts } from '../src/services/http-routes/api-accounts.mjs';
import { serveOps } from '../src/services/http-routes/api-ops.mjs';
import { serveReport } from '../src/services/http-routes/api-report.mjs';
import { serveFeedback } from '../src/services/http-routes/api-feedback.mjs';
import { serveActions } from '../src/services/http-routes/api-actions.mjs';
import { serveAi } from '../src/services/http-routes/api-ai.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function mockRes() {
  const res = {
    status: 200,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers || {};
      return this;
    },
    end(body = '') {
      this.body = body;
      return this;
    },
  };
  return res;
}

async function testStatic() {
  const res = mockRes();
  const handled = serveStatic(new URL('http://x/dashboard-v2'), null, res, { PROJECT_ROOT });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.includes('dashboard-v2'), '应返回 dashboard-v2 HTML');

  const v4 = mockRes();
  assert.strictEqual(serveStatic(new URL('http://x/dashboard-v4'), null, v4, { PROJECT_ROOT }), true);
  assert.strictEqual(v4.status, 200);
  assert.ok(v4.body.includes('实时仪表盘'), '应返回 dashboard-v4 HTML');

  const prod = mockRes();
  assert.strictEqual(serveStatic(new URL('http://x/dashboard'), null, prod, { PROJECT_ROOT }), true);
  assert.strictEqual(prod.status, 200);
  assert.ok(prod.body.includes('实时仪表盘'), '应返回生产版 dashboard-v4 HTML');

  const redirect = mockRes();
  assert.strictEqual(serveStatic(new URL('http://x/'), null, redirect, { PROJECT_ROOT }), true);
  assert.strictEqual(redirect.status, 302);
  assert.strictEqual(redirect.headers.Location, '/dashboard');
  console.log('✅ static routes');
}

async function testSnapshots() {
  const ctx = {
    getLatestSnapshot: () => ({ time: '2026-08-01T00:00:00Z', accountSpend: 100 }),
    get5mSnapshots: (n) => n === 2 ? [{ time: 'a' }, { time: 'b' }] : [{ time: 'b' }],
  };

  const latest = mockRes();
  assert.strictEqual(serveSnapshots(new URL('http://x/api/snapshots'), null, latest, ctx), true);
  assert.strictEqual(latest.status, 200);
  assert.strictEqual(JSON.parse(latest.body).accountSpend, 100);

  const history = mockRes();
  assert.strictEqual(serveSnapshots(new URL('http://x/api/snapshots/5m?history=2'), null, history, ctx), true);
  assert.strictEqual(history.status, 200);
  assert.strictEqual(JSON.parse(history.body).history.length, 2);

  const compare = mockRes();
  assert.strictEqual(serveSnapshots(new URL('http://x/api/snapshots/cpm-compare'), null, compare, {
    get5mSnapshots: () => [{ _recentCPM: 50 }],
    DB_PATH: path.join(os.tmpdir(), 'oec-no-such-cpm.db'),
  }), true);
  assert.strictEqual(compare.status, 200);
  assert.strictEqual(JSON.parse(compare.body).currentCpm, 50);
  assert.strictEqual(JSON.parse(compare.body).yesterdayAvgCpm, 0);

  const kpiCompare = mockRes();
  assert.strictEqual(serveSnapshots(new URL('http://x/api/kpi/compare'), null, kpiCompare, {
    get5mSnapshots: () => [{ _recentCPM: 50, _rolling: { last5min: 10 }, accountBudget: 1000 }],
    DB_PATH: path.join(os.tmpdir(), 'oec-no-such-kpi.db'),
  }), true);
  assert.strictEqual(kpiCompare.status, 200);
  assert.strictEqual(JSON.parse(kpiCompare.body).compare.spend.hasCompare, false);
  console.log('✅ snapshot routes');
}

async function testSnapshotTrend() {
  const res = mockRes();
  const handled = serveSnapshotTrend(new URL('http://x/api/snapshots/trend'), null, res, {
    DB_PATH: path.join(os.tmpdir(), 'oec-no-such.db'),
    parseSnapshotTime: (st) => new Date(st),
  });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.body);
  assert.ok(Array.isArray(body.labels), 'trend 应返回 labels 数组');
  assert.strictEqual(body.totalPlanCount, 0);
  console.log('✅ snapshot trend route');
}

async function testCampaigns() {
  const ctx = {
    classifyDeliveryType: (name) => name.includes('简单投') ? '简单投' : null,
    emptyGroupSummary: (name) => ({ name, spend: 0, leads: 0, cpl: 0, cpm: 0, active: 0, paused: 0, total: 0 }),
    summarizeGroup: (plans, name) => ({ name, spend: 100, leads: 1, cpl: 100, active: 1, paused: 0, total: plans.length }),
    getApiClient: async () => ({
      createClient: async () => ({}),
      getProjects: async () => ({
        projects: [{
          id: '1',
          name: '简单投A',
          project_status_name: '启用',
          campaign_budget: '500',
          metrics: { stat_cost: '1000', convert_cnt: '2', ctr: '1.2' },
        }],
      }),
    }),
  };

  const list = mockRes();
  assert.strictEqual(await serveCampaigns(new URL('http://x/api/campaigns'), null, list, ctx), true);
  assert.strictEqual(list.status, 200);
  const campaigns = JSON.parse(list.body).campaigns;
  assert.strictEqual(campaigns.length, 1);
  assert.strictEqual(campaigns[0].spend, 1000);
  assert.strictEqual(campaigns[0].budget, 500);

  const grouped = mockRes();
  assert.strictEqual(await serveCampaigns(new URL('http://x/api/campaigns/grouped'), null, grouped, ctx), true);
  assert.strictEqual(grouped.status, 200);
  const groupedBody = JSON.parse(grouped.body);
  assert.strictEqual(groupedBody.spending.groups['简单投'].plans.length, 1);
  assert.strictEqual(groupedBody.inactive.groups['简单投'].plans.length, 0);
  assert.strictEqual(groupedBody.session.groups['简单投'].plans.length, 1);
  assert.strictEqual(groupedBody.session.totalSummary.name, '本场');
  console.log('✅ campaign routes');
}

async function testSessionWindow() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oec-session-'));
  try {
    const dataDir = path.join(tmpDir, 'monitor-data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'shifts-2026-08-04.json'), JSON.stringify({
      shifts: [{ label: '22:30-01:30' }],
    }));

    const dbPath = path.join(tmpDir, 'oceanengine.db');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE snapshots (
      snapshot_time TEXT,
      campaign_id TEXT,
      cost REAL,
      leads INTEGER,
      conversions INTEGER
    )`);
    const insert = db.prepare('INSERT INTO snapshots (snapshot_time, campaign_id, cost, leads, conversions) VALUES (?, ?, ?, ?, ?)');
    insert.run('2026-08-04T14:30:00', 'c1', 100, 1, 1);
    insert.run('2026-08-04T14:35:01', 'c1', 100, 1, 1);
    insert.run('2026-08-04T14:55:01', 'c1', 200, 2, 2);
    insert.run('2026-08-04T16:00:00', 'c1', 100, 1, 1);
    insert.run('2026-08-04T16:30:01', 'c1', 200, 2, 2);
    insert.run('2026-08-04T14:35:01', 'c2', 50, 1, 1);
    insert.run('2026-08-04T14:55:01', 'c2', 50, 2, 2);
    insert.run('2026-08-04T16:00:00', 'c2', 50, 1, 1);
    insert.run('2026-08-04T16:30:01', 'c2', 50, 2, 2);
    db.close();

    const now = new Date(2026, 7, 4, 23, 30);
    const win = resolveSessionWindow({
      dataDir,
      getLocalDate: () => '2026-08-04',
      now,
    });
    assert.strictEqual(win.date, '2026-08-04');
    assert.strictEqual(win.startTime, '22:30');
    assert.strictEqual(win.endTime, '01:30');
    assert.strictEqual(win.startCst, '2026-08-04 22:30:00');
    assert.strictEqual(win.endCst, '2026-08-05 01:30:00');

    const rows = getSessionSpendRows(dbPath, win.startCst, win.endCst);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].campaign_id, 'c1');
    assert.strictEqual(rows[0].spend, 200);

    const plans = applySessionSpend([
      { id: 'c1', name: '跨天计划', status: '投放中', spend: 0, leads: 0, conversions: 0, cpa: 0 },
      { id: 'c2', name: '无消耗计划', status: '暂停', spend: 0, leads: 0, conversions: 0, cpa: 0 },
    ], rows);
    assert.strictEqual(plans.length, 1);
    assert.strictEqual(plans[0].spend, 200);
    assert.strictEqual(plans[0].leads, 2);
    assert.strictEqual(plans[0].cpa, 100);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 无起点快照时，窗口首条消耗应计入整场，而不是作为基线减掉
  const tmpNoBase = fs.mkdtempSync(path.join(os.tmpdir(), 'oec-session-nobase-'));
  try {
    const dataDir3 = path.join(tmpNoBase, 'monitor-data');
    fs.mkdirSync(dataDir3, { recursive: true });
    fs.writeFileSync(path.join(dataDir3, 'shifts-2026-08-04.json'), JSON.stringify({
      shifts: [{ label: '22:30-23:30' }],
    }));
    const dbPath3 = path.join(tmpNoBase, 'oceanengine.db');
    const db3 = new Database(dbPath3);
    db3.exec(`CREATE TABLE snapshots (
      snapshot_time TEXT,
      campaign_id TEXT,
      cost REAL,
      leads INTEGER,
      conversions INTEGER
    )`);
    const insert3 = db3.prepare('INSERT INTO snapshots (snapshot_time, campaign_id, cost, leads, conversions) VALUES (?, ?, ?, ?, ?)');
    insert3.run('2026-08-04T14:45:01', 'c1', 100, 1, 1);
    insert3.run('2026-08-04T15:05:01', 'c1', 150, 2, 2);
    db3.close();
    const win3 = resolveSessionWindow({
      dataDir: dataDir3,
      getLocalDate: () => '2026-08-04',
      now: new Date(2026, 7, 4, 23, 20),
    });
    const rows3 = getSessionSpendRows(dbPath3, win3.startCst, win3.endCst);
    assert.strictEqual(rows3.length, 1);
    assert.strictEqual(rows3[0].campaign_id, 'c1');
    assert.strictEqual(rows3[0].spend, 150);
    assert.strictEqual(rows3[0].leads, 2);
  } finally {
    fs.rmSync(tmpNoBase, { recursive: true, force: true });
  }

  // 多日跨天合并:昨日末班 24:00 接今日 0 点首班 → 整场起点回溯到昨日
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'oec-whole-'));
  try {
    const dataDir2 = path.join(tmp2, 'monitor-data');
    fs.mkdirSync(dataDir2, { recursive: true });
    fs.writeFileSync(path.join(dataDir2, 'shifts-2026-08-03.json'), JSON.stringify({
      shifts: [{ label: '20:00-22:00' }, { label: '22:00-24:00' }],
    }));
    fs.writeFileSync(path.join(dataDir2, 'shifts-2026-08-04.json'), JSON.stringify({
      shifts: [{ label: '00:00-02:00' }, { label: '02:00-04:00' }],
    }));
    const win2 = resolveSessionWindow({
      dataDir: dataDir2,
      getLocalDate: () => '2026-08-04',
      now: new Date(2026, 7, 4, 3, 0),
    });
    assert.strictEqual(win2.startDate, '2026-08-03');
    assert.strictEqual(win2.startTime, '20:00');
    assert.strictEqual(win2.endDate, '2026-08-04');
    assert.strictEqual(win2.endTime, '04:00');
    assert.strictEqual(win2.dayCount, 2);
  } finally {
    fs.rmSync(tmp2, { recursive: true, force: true });
  }

  // 单班跨天排班 23:00-01:00:昨日末班 21:00-23:00 接今日 23:00-01:00 → 连续并跨天
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'oec-midnight-'));
  try {
    const dataDir3 = path.join(tmp3, 'monitor-data');
    fs.mkdirSync(dataDir3, { recursive: true });
    fs.writeFileSync(path.join(dataDir3, 'shifts-2026-08-03.json'), JSON.stringify({
      shifts: [{ label: '21:00-23:00' }],
    }));
    fs.writeFileSync(path.join(dataDir3, 'shifts-2026-08-04.json'), JSON.stringify({
      shifts: [{ label: '23:00-01:00' }],
    }));
    const win3 = resolveSessionWindow({
      dataDir: dataDir3,
      getLocalDate: () => '2026-08-04',
      now: new Date(2026, 7, 4, 23, 30),
    });
    assert.strictEqual(win3.startDate, '2026-08-03');
    assert.strictEqual(win3.startTime, '21:00');
    assert.strictEqual(win3.endDate, '2026-08-05');
    assert.strictEqual(win3.endTime, '01:00');
    assert.strictEqual(win3.dayCount, 2);
  } finally {
    fs.rmSync(tmp3, { recursive: true, force: true });
  }
  console.log('✅ session campaign window');
}

async function testAlerts() {
  const res = mockRes();
  const handled = serveAlerts(new URL('http://x/api/alerts'), null, res, {
    getRecentAlerts: () => [{ id: 1 }],
  });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(JSON.parse(res.body).alerts.length, 1);
  console.log('✅ alert routes');
}

async function testLiveStatus() {
  const res = mockRes();
  const handled = serveLiveStatus(new URL('http://x/api/live-status'), null, res, {
    getLocalDate: () => '2026-08-01',
    DATA_DIR: path.join(PROJECT_ROOT, 'monitor-data'),
    getLatestSnapshot: () => ({ totalSpend: 100, shifts: [] }),
  });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(JSON.parse(res.body).kpi.totalSpend, 100);
  console.log('✅ live-status routes');
}

async function testAccounts() {
  const res = mockRes();
  const handled = await serveAccounts(new URL('http://x/api/accounts'), null, res, {
    getLatestSnapshot: () => ({ summary: { accountSpend: 200, totalLeads: 1, totalActive: 2 } }),
    ACCOUNT_ID: '123',
    ACCOUNT_NAME: '测试账户',
    getApiClient: async () => ({
      createClient: async () => ({}),
      getProjects: async () => ({ projects: [] }),
    }),
  });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(JSON.parse(res.body).accounts[0].id, '123');

  const detail = mockRes();
  const detailHandled = await serveAccounts(new URL('http://x/api/accounts/123'), null, detail, {
    getLatestSnapshot: () => null,
    ACCOUNT_ID: '123',
    ACCOUNT_NAME: '测试账户',
    getApiClient: async () => ({
      createClient: async () => ({}),
      getProjects: async () => ({ projects: [] }),
    }),
  });
  assert.strictEqual(detailHandled, true);
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(JSON.parse(detail.body).account.id, '123');
  console.log('✅ account routes');
}

async function testOps() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oec-http-routes-'));
  try {
    const push = mockRes();
    assert.strictEqual(serveOps(new URL('http://x/api/manual-push'), null, push, { DATA_DIR: tmpDir }), true);
    assert.strictEqual(push.status, 200);
    assert.ok(fs.existsSync(path.join(tmpDir, 'manual-push-signal.json')), '应写入 manual-push 信号');

    const req = {
      on(ev, cb) { this[ev] = cb; },
      emit(ev, arg) {
        if (ev === 'data') this.data(arg);
        else if (ev === 'end') this.end();
      },
    };
    const repush = mockRes();
    assert.strictEqual(serveOps(new URL('http://x/api/repush'), req, repush, { DATA_DIR: tmpDir }), true);
    req.emit('data', JSON.stringify({ type: 'card' }));
    req.emit('end');
    assert.strictEqual(repush.status, 200);
    assert.ok(fs.existsSync(path.join(tmpDir, 'repush-signal.json')), '应写入 repush 信号');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log('✅ ops routes');
}

async function testReport() {
  const history = mockRes();
  assert.strictEqual(serveReport(new URL('http://x/history'), null, history, {
    PROJECT_ROOT,
    getLocalDate: () => '2026-08-01',
    loadSuggestionHistory: () => ({ suggestions: [] }),
    saveSuggestionHistory: () => {},
    recalcSummary: () => {},
    sanitize: (v) => String(v || ''),
  }), true);
  assert.strictEqual(history.status, 200);
  assert.deepStrictEqual(JSON.parse(history.body), { suggestions: [] });
  console.log('✅ report routes');
}

async function testFeedback() {
  const ctx = {
    sanitize: (v) => String(v || ''),
    escHtml: (v) => String(v || ''),
    recordFeedback: async () => {},
  };
  const ok = mockRes();
  assert.strictEqual(await serveFeedback(new URL('http://x/feedback?action=accept&alertId=1&type=zero_conv&name=计划A'), null, ok, ctx), true);
  assert.strictEqual(ok.status, 200);
  assert.ok(ok.body.includes('已采纳'), '应返回采纳反馈页');

  const bad = mockRes();
  assert.strictEqual(await serveFeedback(new URL('http://x/feedback?action=bad'), null, bad, ctx), true);
  assert.strictEqual(bad.status, 400);
  console.log('✅ feedback routes');
}

function fakeBodyReq() {
  return {
    on(ev, cb) { this[ev] = cb; },
    emit(ev, arg) {
      if (ev === 'data') this.data(arg);
      else if (ev === 'end') this.end();
    },
  };
}

async function testActions() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oec-http-actions-'));
  try {
    const ctx = {
      sanitize: (v) => String(v || ''),
      withWriteLock: async (fn) => fn(),
      ACTION_QUEUE_FILE: path.join(tmpDir, 'action-queue.json'),
      ACTION_PENDING_FILE: path.join(tmpDir, 'pending-actions.json'),
      ACTION_AUDIT_FILE: path.join(tmpDir, 'action-audit.jsonl'),
    };
    fs.writeFileSync(ctx.ACTION_PENDING_FILE, JSON.stringify({ pending: [{ id: 1 }] }));
    fs.writeFileSync(ctx.ACTION_AUDIT_FILE, JSON.stringify({ time: 't', planName: 'P', actionType: 'pause', result: { ok: true } }) + '\n');

    const queue = mockRes();
    assert.strictEqual(serveActions(new URL('http://x/api/actions'), null, queue, ctx), true);
    assert.strictEqual(queue.status, 200);
    assert.deepStrictEqual(JSON.parse(queue.body), { actions: [] });

    const pending = mockRes();
    assert.strictEqual(serveActions(new URL('http://x/api/pending'), null, pending, ctx), true);
    assert.strictEqual(JSON.parse(pending.body).data.length, 1);

    const audit = mockRes();
    assert.strictEqual(serveActions(new URL('http://x/api/audit/recent'), null, audit, ctx), true);
    assert.strictEqual(JSON.parse(audit.body).total, 1);

    const enqueue = mockRes();
    const enqueueReq = fakeBodyReq();
    enqueueReq.method = 'POST';
    assert.strictEqual(serveActions(new URL('http://x/api/actions'), enqueueReq, enqueue, ctx), true);
    enqueueReq.emit('data', JSON.stringify({ type: 'pause', campaign_id: '1' }));
    enqueueReq.emit('end');
    assert.strictEqual(enqueue.status, 200);
    assert.strictEqual(JSON.parse(fs.readFileSync(ctx.ACTION_QUEUE_FILE, 'utf-8')).actions.length, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log('✅ action routes');
}

async function testAi() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oec-http-ai-'));
  try {
    const auditFile = path.join(tmpDir, 'action-audit.jsonl');
    fs.writeFileSync(auditFile, JSON.stringify({ actionType: 'pause', planName: 'P' }) + '\n');
    const res = mockRes();
    const handled = await serveAi(new URL('http://x/api/ai/learning-data'), null, res, {
      ACTION_AUDIT_FILE: auditFile,
      computeActionEffect: () => ({ status: 'evaluated' }),
      extractRules: () => [],
      classifyDeliveryType: () => '其他',
      getApiClient: async () => ({
        createClient: async () => ({}),
        getProjects: async () => ({ projects: [] }),
      }),
      ANOMALY_MIN_SPEND: 500,
      ANOMALY_MAX_CPA: 150,
    });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.summary.totalAudits, 1);
    assert.strictEqual(body.summary.evaluatedActions, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log('✅ ai routes');
}

async function run() {
  await testStatic();
  await testSnapshots();
  await testSnapshotTrend();
  await testCampaigns();
  await testSessionWindow();
  await testAlerts();
  await testLiveStatus();
  await testAccounts();
  await testOps();
  await testReport();
  await testFeedback();
  await testActions();
  await testAi();
  console.log('\n全部测试通过');
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
