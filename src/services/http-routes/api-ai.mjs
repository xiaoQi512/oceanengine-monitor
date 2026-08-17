// src/services/http-routes/api-ai.mjs - AI 学习数据与诊断建议 API
import fs from 'node:fs';
import {
  buildDiagnosisSuggestions,
  summarizeDiagnosis,
} from '../../domain/ai-diagnosis.mjs';

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
    loadSuggestionHistory,
    getLatestSnapshot,
  } = ctx;
  const accountId = url.searchParams.get('accountId') || '';

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

      let diagnosis = [];
      let diagnosisSummary = { total: 0, byType: {}, highCount: 0, mediumCount: 0 };
      try {
        const history = typeof loadSuggestionHistory === 'function' ? loadSuggestionHistory() : null;
        const latest = typeof getLatestSnapshot === 'function' ? getLatestSnapshot({ accountId }) : null;
        const analysis = latest ? {
          alerts: latest.alerts || [],
          delta: latest.delta || {},
          summary: latest.summary || {},
        } : null;
        diagnosis = buildDiagnosisSuggestions({
          alerts: analysis?.alerts || [],
          analysis,
          history,
          rules,
          now: new Date().toISOString(),
        });
        diagnosisSummary = summarizeDiagnosis(diagnosis);
      } catch (e) {
        console.error('[ai-diagnosis] 生成诊断失败:', e.message);
      }


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
          status: p.project_status_name || p.project_status_first_name || p.status_str || '',
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
        diagnosis,
        diagnosisSummary,
      summary: {
        totalAudits: lines.length,
        evaluatedActions: eventsWithEffect.filter(e => e.effect?.status === 'evaluated').length,
        rulesCount: rules.length,
      },
    }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message, rules: [], recentActions: [], anomalies: [], diagnosis: [], diagnosisSummary: { total: 0, byType: {}, highCount: 0, mediumCount: 0 } }));
  }
  return true;
}
