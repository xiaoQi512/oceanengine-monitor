// src/services/daily-report-html.mjs - 日报 HTML 落盘与兼容导出
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../utils/monitor-utils.mjs';
import { buildDailyReportHtml } from '../domain/daily-report-html-template.mjs';

export { buildDailyReportHtml };

export function writeDailyReportHtml({
  today,
  entries,
  gaps,
  metrics,
  reportDir = PROJECT_ROOT,
  fsImpl = fs,
  pathImpl = path,
  logFn = console.log,
}) {
  const html = buildDailyReportHtml({ today, entries, gaps, metrics });
  const reportFile = pathImpl.join(reportDir, `oceanengine-daily-${today}.html`);
  const latestFile = pathImpl.join(reportDir, 'oceanengine-daily-latest.html');
  fsImpl.writeFileSync(reportFile, html);
  fsImpl.writeFileSync(latestFile, html);
  logFn(`✅ HTML 日报已生成: ${reportFile}`);
  return { reportFile, latestFile };
}
