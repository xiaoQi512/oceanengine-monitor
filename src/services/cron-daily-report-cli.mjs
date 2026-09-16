// src/services/cron-daily-report-cli.mjs - PM2/命令行启动入口
import { assertConfig } from '../config/index.mjs';
import { runCli } from './cron-daily-report.mjs';

assertConfig();

// 调度窗口守卫: PM2 resurrect/手动 restart 会把 cron_restart 任务立即误触发一次
// (2026-09-17 02:10 实锤: 电脑重启后日报在凌晨被拉起并 Fatal)。非预期小时直接退出。
const EXPECTED_HOUR = 23; // cron_restart = "5 23 * * *"
const nowHour = new Date().getHours();
if (nowHour !== EXPECTED_HOUR && process.env.OEC_FORCE !== '1') {
  console.log(`[cron-daily-report] 非调度窗口(当前 ${nowHour} 点, 预期 ${EXPECTED_HOUR} 点), 跳过执行`);
  process.exit(0);
}

runCli().catch(e => {
  console.error('[cron-daily-report] Fatal:', e);
  process.exit(1);
});
