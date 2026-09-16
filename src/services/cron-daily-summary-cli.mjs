// src/services/cron-daily-summary-cli.mjs - PM2/命令行启动入口
import { assertConfig } from '../config/index.mjs';
import { runCli } from './cron-daily-summary.mjs';

assertConfig();

// 调度窗口守卫: 防 PM2 resurrect/手动 restart 误触发 (cron_restart = "34 23 * * *")
const EXPECTED_HOUR = 23;
const nowHour = new Date().getHours();
if (nowHour !== EXPECTED_HOUR && process.env.OEC_FORCE !== '1') {
  console.log(`[cron-daily-summary] 非调度窗口(当前 ${nowHour} 点, 预期 ${EXPECTED_HOUR} 点), 跳过执行`);
  process.exit(0);
}

runCli();
