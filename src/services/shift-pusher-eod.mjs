// src/services/shift-pusher-eod.mjs - shift-pusher 日终任务触发
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PROJECT_ROOT, getLocalDate } from '../utils/monitor-utils.mjs';
import { log } from './shift-pusher-state.mjs';

const _eodTriggered = new Set();

export async function triggerEndOfDayTasks({
  shift,
  todayShifts,
  getShiftEndMinutes,
  getLocalDateFn = getLocalDate,
  projectRoot = PROJECT_ROOT,
  logFn = log,
  spawnFn = spawn,
  setTimeoutFn = setTimeout,
  nodeExe = process.execPath,
  env = process.env,
} = {}) {
  const today = getLocalDateFn();
  if (_eodTriggered.has(today)) return;

  const sorted = [...todayShifts].sort((a, b) => getShiftEndMinutes(b) - getShiftEndMinutes(a));
  if (sorted.length === 0) return;
  if (shift.label !== sorted[0].label) return;

  _eodTriggered.add(today);
  logFn('[EOD] 最后一场 ' + shift.label + ' 结束，触发日终任务...');

  const cwd = projectRoot;
  const DATA_DELAY = 4 * 60_000;
  const tasks = [
    { name: 'sync-tomorrow', script: 'src/services/cron-sync-shifts-cli.mjs', delay: 0 },
    { name: 'daily-report', script: 'src/services/cron-daily-report-cli.mjs', delay: DATA_DELAY },
    { name: 'daily-summary', script: 'src/services/cron-daily-summary-cli.mjs', delay: DATA_DELAY + 30_000 },
    { name: 'ai-regions', script: 'src/services/cron-ai-regions-cli.mjs', delay: DATA_DELAY + 60_000 },
  ];

  for (const task of tasks) {
    setTimeoutFn(() => {
      logFn('[EOD] 触发: ' + task.name + ' (' + task.script + ')');
      const child = spawnFn(nodeExe, [path.join(cwd, task.script)], {
        cwd,
        stdio: 'ignore',
        detached: true,
        env: { ...env, OEC_SILENT: '1' },
      });
      child.unref();
    }, task.delay);
  }
}
