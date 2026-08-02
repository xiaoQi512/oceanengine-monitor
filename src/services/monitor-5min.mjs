// monitor-5min.mjs - 5分钟轻量消耗汇报
// 在15分钟完整汇报之间(每5分钟)推送简洁消耗卡片到飞书群
// 测试模式: OEC_FORCE=1 绕整点跳过; OEC_DRY_RUN=1 不发送实际推送
import { DATA_DIR } from '../utils/monitor-utils.mjs';
import { runMonitorCli } from './monitor-cli.mjs';
import { runFiveMinCycle } from './five-min-cycle.mjs';

const OEC_FORCE = process.env.OEC_FORCE === '1';
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === '1';
const PM2_PREFIX = process.env.OEC_PM2_TEST === '1' ? '🧪 [PM2测试] ' : '';

async function main() {
  await runFiveMinCycle({
    force: OEC_FORCE,
    dryRun: OEC_DRY_RUN,
    pm2Prefix: PM2_PREFIX,
    dataDir: DATA_DIR,
  });
}

export function runCli() {
  runMonitorCli({ run: main });
}
