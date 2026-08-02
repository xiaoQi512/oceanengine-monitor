// src/domain/report-html.mjs - 离线快照 HTML 报表构建（纯逻辑）
import { escHtml } from './helpers.mjs';
import { buildReportHtmlTemplate } from './report-html-template.mjs';
import {
  buildAlertRows,
  buildAllPlanRows,
  buildHistoryRows,
  buildFunnelBar,
  buildCampaignRows,
} from './report-html-parts.mjs';

export function generateMonitorHTML(
  analysis,
  {
    history = { summary: {}, suggestions: [] },
    now = new Date().toLocaleString('zh-CN'),
    today = '',
    liveWin = { label: '', labelCompact: '' },
    accountName = '',
  } = {}
) {
  const { summary, active, allSpending, topNewSpenders, alerts, delta, rampingUp, dropping } = analysis;
  const d = delta || {};

  const alertsHTML = buildAlertRows(alerts, history);

  // ====== 全量计划表 (所有有消耗的计划，按消耗降序) ======
  const planList = (allSpending && allSpending.length > 0) ? allSpending : (active || []);
  const allPlanRows = buildAllPlanRows(planList, summary);

  // ====== 建议历史摘要 ======
  const histRows = buildHistoryRows(history);

  // ====== 转化漏斗可视化 ======
  const maxFunnel = Math.max(summary.totalPrivateMsgOpen || 1, summary.totalPrivateMsgRetain || 1, summary.totalFormSubmit || 1, summary.totalLeads || 1, summary.totalConversions || 1);
  const funnelBar = (val, label, color) => buildFunnelBar(val, label, color, maxFunnel);
  const campaignRows = buildCampaignRows(topNewSpenders, summary, delta);

  return buildReportHtmlTemplate({ today, now, liveWin, accountName, summary, d, rampingUp, dropping, alerts, alertsHTML, planList, allPlanRows, histRows, funnelBar, campaignRows });
}
