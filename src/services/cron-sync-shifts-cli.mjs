// src/services/cron-sync-shifts-cli.mjs - PM2/命令行启动入口
import { assertConfig } from '../config/index.mjs';
import { runCli } from './cron-sync-shifts.mjs';

assertConfig();
runCli();
