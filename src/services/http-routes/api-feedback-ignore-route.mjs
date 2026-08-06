// src/services/http-routes/api-feedback-ignore-route.mjs - "暂不处理"反馈路由
// 用户在需要处理模块点击"暂不处理"并填写原因 → 写入 action-audit.jsonl
// 审计记录 actionType=ignore,供 extractRules 学习"用户不调整的原因"。
import fs from 'node:fs';
import path from 'node:path';

export function serveFeedbackIgnore(url, req, res, ctx) {
  if (url.pathname !== '/api/feedback/ignore' || !req || req.method !== 'POST') return false;
  const { ACTION_AUDIT_FILE } = ctx;
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const data = JSON.parse(body || '{}');
      const planName = String(data.planName || '').trim();
      if (!planName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'planName 必填' }));
        return;
      }
      const reason = String(data.reason || '').trim().slice(0, 500);
      const by = String(data.by || 'dashboard').slice(0, 50);
      const nowIso = new Date().toISOString();
      const record = {
        traceRef: 'ignore_' + Date.now(),
        actionType: 'ignore',
        planName,
        projectId: String(data.campaignId || data.campaign_id || ''),
        reason,
        by,
        source: data.source || 'dashboard',
        // 反馈详情
        feedback: {
          action: 'ignore',
          reason,
          at: nowIso,
          planKey: planName,
        },
        result: { ok: true, method: 'feedback', ignored: true },
        time: nowIso,
      };
      if (ACTION_AUDIT_FILE) {
        fs.mkdirSync(path.dirname(ACTION_AUDIT_FILE), { recursive: true });
        fs.appendFileSync(ACTION_AUDIT_FILE, JSON.stringify(record) + '\n', 'utf-8');
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, record }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  return true;
}
