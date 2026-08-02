// monitor-15min.mjs - 15min 巨量引擎监控入口
// 编排逻辑位于 monitor-cycle.mjs，本文件仅保留 CLI 启动与数据断层记录。

import {
  getLocalDate, atomicWriteJSON,
} from '../utils/monitor-utils.mjs';
import { recordDataGap } from './monitor-state.mjs';
import { CONFIG } from './monitor-config.mjs';
import { runMonitorCli } from './monitor-cli.mjs';
import { runMonitorCycle } from './monitor-cycle.mjs';

const OEC_FORCE = process.env.OEC_FORCE === '1';
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === '1';

// ====== 主流程 ======
async function main() {
  const result = await runMonitorCycle({
    config: CONFIG,
    force: OEC_FORCE,
    dryRun: OEC_DRY_RUN,
  });
  if (result.stopped) process.exit(0);
}

export function runCli() {
  runMonitorCli({
    run: main,
    onError: msg => {
      try { recordDataGap(`监控脚本异常: ${msg.slice(0, 200)}`, { dataDir: CONFIG.dataDir, getLocalDate, atomicWriteJSON }); } catch {}
    },
  });
}
