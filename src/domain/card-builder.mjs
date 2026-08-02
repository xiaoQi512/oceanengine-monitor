// src/domain/card-builder.mjs - 飞书交互卡片构建（纯逻辑）
import { getTimeSlotAdvice } from './helpers.mjs';
import { getSuggestionInsight } from './suggestions.mjs';
import { buildPacingLines, buildMetricsLines } from './card-sections.mjs';
import { classifyCardAlerts, buildAlertLines } from './card-alert-classifier.mjs';
import { buildTopSpendLines } from './card-top-lines.mjs';
import { buildBudgetExceededContent, buildYoyContent, buildMultiDayContent, buildLifecycleContent } from './card-baselines.mjs';
import { buildCardElements } from './card-element-builder.mjs';

export function buildCardMessage(
  analysis,
  {
    topNewSpenders,
    history = { summary: {}, suggestions: [] },
    now = new Date().toLocaleString('zh-CN'),
    liveWin = { label: '', labelCompact: '' },
    pm2Prefix = '',
    enableHtmlReport = false,
  } = {}
) {
  const { summary, alerts, rampingUp, dropping, delta } = analysis;
  const finalTopNewSpenders = topNewSpenders !== undefined ? topNewSpenders : (analysis.topNewSpenders || []);
  const d = delta || {};
  const hasAlerts = alerts.length > 0;
  const { highAlerts, midAlerts, actionAlerts, infoAlerts } = classifyCardAlerts(alerts, history);

  // 卡片头部
  const headerColor = hasAlerts ? (highAlerts.length > 0 ? 'red' : 'orange') : 'green';
  const statusIcon = highAlerts.length > 0 ? '🔴' : midAlerts.length > 0 ? '🟡' : '✅';
  const alertSummary = hasAlerts
    ? `${alerts.length}条告警 (待处理${actionAlerts.length}条)`
    : '运行正常';

  // ====== Section 1-3: 节奏/指标/告警区块 ======
  const pacingLines = buildPacingLines(d, summary);
  const metricsLines = buildMetricsLines(d, summary, rampingUp, dropping);
  const alertLines = buildAlertLines(infoAlerts);

  // ====== Section 4: TOP新增消耗 + 趋势 ======
  const topLines = buildTopSpendLines(finalTopNewSpenders, d.age15);

  // ====== Build Elements ======
  const budgetExceededContent = buildBudgetExceededContent(analysis);
  const yoyContent = buildYoyContent(d, summary);
  const multiDayContent = buildMultiDayContent(analysis._multiDay, summary);
  const lifecycleContent = buildLifecycleContent(d);
  const advice = getTimeSlotAdvice(d.timeSlot, d.budgetUsed, (rampingUp||[]).length, (dropping||[]).length);
  const insight = getSuggestionInsight(history);
  const elements = buildCardElements({ pacingLines, metricsLines, alertLines, topLines, budgetExceededContent, rampingUp, yoyContent, multiDayContent, lifecycleContent, advice, insight, enableHtmlReport, now, d, liveWin });

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${pm2Prefix}${statusIcon} 极狐直播 · ${alertSummary}${d.timeSlot ? ' · ' + d.timeSlot : ''}` },
      template: headerColor
    },
    elements: elements,
    _pendingSuggestions: [],
  };
}
