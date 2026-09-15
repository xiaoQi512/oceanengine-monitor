// 云托管中枢服务 - 巨量引擎监控小程序后端
// 部署于微信云托管, 同环境内通过 @cloudbase/node-sdk 访问云开发数据库(免密钥)
//
// 鉴权双通道:
//   1. 家里脚本/外部: header X-API-Key 必须等于环境变量 API_KEY
//   2. 小程序 callContainer: 微信侧自动注入 X-WX-OPENID, 必须命中 OPENID_WHITELIST
//
// 环境变量(云托管控制台-服务设置-环境变量):
//   API_KEY          外部调用密钥(自拟, 32位+随机串)
//   OPENID_WHITELIST 允许操作的 openid, 逗号分隔(自己的openid)
//   TCB_ENV          通常自动注入, 未注入时填云开发环境ID
//
// 数据库集合(云开发控制台创建):
//   latest_summary  每次推送覆盖1条  { updated_at, payload }
//   campaigns       全量重建          { campaign_id, name, status, cost, budget, leads, cpa, ... }
//   alerts          当日告警          { alert_id, severity, type, campaign, time, message, suggestion }
//   actions         指令队列          { action_id, action, campaign_id, campaign_name, params, status, openid, created_at, result }

const express = require('express');
const Cloudbase = require('@cloudbase/node-sdk');

const app = express();
app.use(express.json({ limit: '2mb' }));

const API_KEY = process.env.API_KEY || '';
const WHITELIST = (process.env.OPENID_WHITELIST || '').split(',').map(s => s.trim()).filter(Boolean);
const ENV = process.env.TCB_ENV || process.env.SCF_NAMESPACE || '';

let sdk = null;
function db() {
  if (!sdk) {
    sdk = Cloudbase.init({ env: ENV });
  }
  return sdk.database();
}

// ---------- 鉴权 ----------
function auth(req) {
  if (API_KEY && req.get('X-API-Key') === API_KEY) return { role: 'service' };
  const openid = req.get('X-WX-OPENID');
  if (openid && WHITELIST.includes(openid)) return { role: 'user', openid };
  return null;
}
function requireAuth(req, res, next) {
  const a = auth(req);
  if (!a) return res.status(401).json({ error: 'unauthorized' });
  req.auth = a;
  next();
}
// 仅小程序用户可下指令(防止API Key 泄露后被外部直接下指令)
function requireUser(req, res, next) {
  if (req.auth.role !== 'user') return res.status(403).json({ error: 'openid required' });
  next();
}

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// 首次配置用: 小程序内访问可看到自己的 openid, 用于填 OPENID_WHITELIST
app.get('/whoami', (req, res) => {
  const openid = req.get('X-WX-OPENID') || '';
  res.json({
    openid,
    whitelisted: !WHITELIST.length ? 'WHITELIST_EMPTY' : WHITELIST.includes(openid),
    env: ENV
  });
});

// ---------- 数据推送(家里 PM2 调用) ----------
app.post('/push', requireAuth, async (req, res) => {
  const { summary, campaigns, alerts } = req.body || {};
  const tryDb = async fn => { try { await fn(); return null; } catch (e) { return e.message; } };
  const errors = [];

  if (summary) {
    errors.push(await tryDb(async () => {
      const coll = db().collection('latest_summary');
      const old = await coll.limit(5).get();
      for (const doc of old.data) await coll.doc(doc._id).remove();
      await coll.add({ updated_at: new Date().toISOString(), payload: summary });
    }));
  }
  if (Array.isArray(campaigns)) {
    errors.push(await tryDb(async () => {
      const coll = db().collection('campaigns');
      const old = await coll.limit(1000).get();
      for (const doc of old.data) await coll.doc(doc._id).remove();
      for (const c of campaigns.slice(0, 200)) {
        await coll.add({ ...c, synced_at: new Date().toISOString() });
      }
    }));
  }
  if (Array.isArray(alerts)) {
    errors.push(await tryDb(async () => {
      const coll = db().collection('alerts');
      // 只保留今日: 先按 alert_id 去重写入, 全量重建当日视图
      const old = await coll.limit(1000).get();
      for (const doc of old.data) await coll.doc(doc._id).remove();
      for (const a of alerts.slice(0, 200)) {
        await coll.add({ ...a, synced_at: new Date().toISOString() });
      }
    }));
  }
  const failed = errors.filter(Boolean);
  if (failed.length) return res.status(500).json({ ok: false, errors: failed });
  res.json({ ok: true });
});

// ---------- 小程序读取 ----------
app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const s = await db().collection('latest_summary').orderBy('updated_at', 'desc').limit(1).get();
    if (!s.data.length) return res.status(404).json({ error: 'no data' });
    res.json(s.data[0].payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/campaigns', requireAuth, async (req, res) => {
  try {
    const r = await db().collection('campaigns').limit(200).get();
    res.json({ campaigns: r.data.map(({ _id, ...c }) => ({ id: _id, ...c })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/alerts', requireAuth, async (req, res) => {
  try {
    const r = await db().collection('alerts').orderBy('time', 'desc').limit(100).get();
    res.json({ alerts: r.data.map(({ _id, ...a }) => ({ id: a.alert_id || _id, ...a })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- 指令(小程序 → 云 → 家里) ----------
const VALID_ACTIONS = ['pause', 'enable', 'update_budget'];
const ACTION_ID = () => 'cmd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

app.post('/command', requireAuth, requireUser, async (req, res) => {
  const { action, campaign_id, campaign_name, params = {} } = req.body || {};
  if (!VALID_ACTIONS.includes(action)) return res.status(400).json({ error: 'invalid action' });
  if (action === 'update_budget' && (!params.budget || params.budget < 50)) {
    return res.status(400).json({ error: 'budget invalid' });
  }
  const action_id = ACTION_ID();
  try {
    await db().collection('actions').add({
      action_id,
      action,                     // pause | enable | update_budget
      campaign_id: campaign_id || '',
      campaign_name: campaign_name || '',
      params,
      status: 'pending',          // pending → claimed → done | failed
      openid: req.auth.openid,
      created_at: new Date().toISOString(),
      result: null
    });
    res.json({ ok: true, action_id, status: 'queued' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 家里 poller 拉取: 取 pending 标记 claimed
app.get('/actions/pending', requireAuth, async (req, res) => {
  try {
    const r = await db().collection('actions')
      .where({ status: 'pending' }).limit(10).get();
    for (const doc of r.data) {
      await db().collection('actions').doc(doc._id).update({ status: 'claimed', claimed_at: new Date().toISOString() });
    }
    res.json({ actions: r.data.map(({ _id, ...a }) => ({ _id, ...a })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 家里 poller 回写执行结果
app.post('/actions/result', requireAuth, async (req, res) => {
  const { action_id, status, result } = req.body || {};
  if (!action_id || !['done', 'failed'].includes(status)) {
    return res.status(400).json({ error: 'invalid params' });
  }
  try {
    await db().collection('actions')
      .where({ action_id })
      .update({ status, result: result || null, finished_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 80;
app.listen(PORT, () => console.log(`monitor-api listening on :${PORT}`));
