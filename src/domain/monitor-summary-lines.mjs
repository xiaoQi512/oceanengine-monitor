// src/domain/monitor-summary-lines.mjs - 监控摘要文本兼容入口
import { buildMonitorSummaryHeaderLines, buildMonitorSummaryBodyLines, buildMonitorSummaryFooterLines } from './monitor-summary-sections.mjs';

export function buildMonitorSummaryLines(analysis, elapsed) {
  return [
    ...buildMonitorSummaryHeaderLines(analysis),
    ...buildMonitorSummaryBodyLines(analysis),
    ...buildMonitorSummaryFooterLines(analysis, elapsed),
  ];
}
