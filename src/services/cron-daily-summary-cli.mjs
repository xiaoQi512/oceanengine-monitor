// src/services/cron-daily-summary-cli.mjs - PM2/命令行启动入口
import { assertConfig } from '../config/index.mjs';
import { runCli } from './cron-daily-summary.mjs';

assertConfig();
runCli();
