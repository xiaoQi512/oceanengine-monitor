// src/domain/monitor-summary-footer.mjs - 监控摘要页脚

export function buildMonitorSummaryFooterLines(analysis, elapsed) {
  const lines = [];
  if (analysis.alerts.length > 0) {
    lines.push('\n⚠️ 告警:');
    analysis.alerts.filter(a => a.severity === 'high').forEach(a => lines.push(`  🔴 ${a.name}: ${a.detail}`));
    analysis.alerts.filter(a => a.severity === 'medium').forEach(a => lines.push(`  🟡 ${a.name}: ${a.detail}`));
  }
  lines.push(`⏱ 耗时: ${elapsed}s`);
  return lines;
}
