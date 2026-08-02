// action-worker.mjs - action 队列 Worker 入口
// 运行编排位于 action-worker-run.mjs
import { runMonitorCli } from './monitor-cli.mjs';
import { runOnce, runWatch } from './action-worker-run.mjs';
import { acquireLock, releaseLock } from './action-store.mjs';

export function runCli() {
  const args = process.argv.slice(2);
  if (args.includes('--watch')) {
    runMonitorCli({ run: runWatch });
  } else {
    runMonitorCli({
      run: runOnce,
      onSuccess: r => {
        console.log('[worker] 完成:', JSON.stringify(r).slice(0, 200));
        process.exit(r.processed ? 0 : 0);
      },
    });
  }
}

export { processHead, runOnce } from './action-worker-run.mjs';
export { acquireLock, releaseLock } from './action-store.mjs';
