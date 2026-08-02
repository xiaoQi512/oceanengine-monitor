// cron-daily-report.mjs - 日报汇总入口
// 运行编排位于 daily-report-run.mjs
import { runDailyReport } from './daily-report-run.mjs';

export async function runCli() {
  await runDailyReport();
}
