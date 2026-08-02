// src/services/cron-daily-report-cli.mjs - PM2/命令行启动入口
import { assertConfig } from '../config/index.mjs';
import { runCli } from './cron-daily-report.mjs';

assertConfig();
runCli().catch(e => {
  console.error('[cron-daily-report] Fatal:', e);
  process.exit(1);
});
