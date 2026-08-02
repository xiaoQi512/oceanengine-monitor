// src/domain/html-report-decision.mjs - HTML 报表发送决策（纯逻辑）

export function shouldSendHtmlReport({ analysis, enableHtmlReport }) {
  if (!enableHtmlReport) return { send: false, reason: 'disabled' };
  const hasData = (analysis.active?.length > 0 && analysis.summary?.totalSpend > 0);
  return hasData ? { send: true, reason: 'ok' } : { send: false, reason: 'no_data' };
}
