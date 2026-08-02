// src/services/daily-report-run-finalize.mjs - 日报最终卡片与推送
import { buildDailyReportCard } from './daily-report-core.mjs';
import { pushDailyReportCard } from './daily-report-push.mjs';

export async function finalizeDailyReport({
  today,
  entries,
  gaps,
  metrics,
  freshData,
  slotLines,
  insightLines,
  larkCli,
  chatId,
  log,
}) {
  const cardContent = buildDailyReportCard({
    today,
    entries,
    gaps,
    freshData,
    finalSpend: metrics.finalSpend,
    effectiveBudget: metrics.effectiveBudget,
    budgetPct: metrics.budgetPct,
    finalConversions: metrics.finalConversions,
    totalLeads: metrics.totalLeads,
    finalCPA: metrics.finalCPA,
    openRetainStr: metrics.openRetainStr,
    totalAlerts: metrics.totalAlerts,
    slotLines,
    insightLines,
  });
  await pushDailyReportCard({ larkCli, chatId, cardContent, logFn: log });
  log('🎉 23:05 日报汇总完成');
}
