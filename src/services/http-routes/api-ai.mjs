// src/services/http-routes/api-ai.mjs - AI 学习数据 API
import fs from 'node:fs';

export async function serveAi(url, req, res, ctx) {
  if (url.pathname !== '/api/ai/learning-data') return false;

  const {
    ACTION_AUDIT_FILE,
    computeActionEffect,
    extractRules,
    classifyDeliveryType,
    getApiClient,
    ANOMALY_MIN_SPEND,
    ANOMALY_MAX_CPA,
  } = ctx;

  try {
    const raw = fs.existsSync(ACTION_AUDIT_FILE) ? fs.readFileSync(ACTION_AUDIT_FILE, 'utf-8') : '';
    const lines = raw.split('\n').filter(Boolean);
    const recentAudits = lines.slice(-50).reverse().map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    const eventsWithEffect = recentAudits.map(a => ({
      ...a,
      effect: computeActionEffect(a),
    }));

    const rules = extractRules(eventsWithEffect);

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
        if (p.spend < ANOMALY_MIN_SPEND) return false;
        if (p.leads === 0) return true;
        if (p.cpa > ANOMALY_MAX_CPA) return true;
        return false;
      });
    } catch {}

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
  return true;
}
