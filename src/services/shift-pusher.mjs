// shift-pusher.mjs - 主播换班数据推送入口
// 排班/轮询/单班次业务位于 shift-pusher-* 模块
import { runMonitorCli } from './monitor-cli.mjs';
import { runShiftPusherMain } from './shift-pusher-run.mjs';
import { runShift } from './shift-pusher-shift.mjs';

const OEC_FORCE = process.env.OEC_FORCE === '1';
const OEC_SHIFT_LABEL = process.env.OEC_SHIFT_LABEL || '';

async function main() {
  await runShiftPusherMain({ runShift, force: OEC_FORCE, shiftLabel: OEC_SHIFT_LABEL });
}

export function runCli() {
  runMonitorCli({ run: main });
}
