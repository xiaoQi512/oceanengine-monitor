// src/domain/monitor-summary.mjs - 监控摘要控制台输出
import { buildMonitorSummaryLines } from './monitor-summary-lines.mjs';

export function printMonitorSummary(analysis, elapsed) {
  for (const line of buildMonitorSummaryLines(analysis, elapsed)) {
    console.log(line);
  }
}
