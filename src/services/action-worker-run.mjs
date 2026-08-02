// src/services/action-worker-run.mjs - action worker 运行编排
import { acquireLock, releaseLock, loadQueue, saveQueue, writeAudit } from './action-store.mjs';
import { reportToFeishu, executeAction, tryHttpApi, isChromeHealthy, readPlanAfterValue } from './action-executor.mjs';
import { processHead as processHeadCore } from './action-process.mjs';

const defaultDeps = {
  acquireLock,
  releaseLock,
  loadQueue,
  saveQueue,
  writeAudit,
  reportToFeishu,
  executeAction,
  tryHttpApi,
  isChromeHealthy,
  readPlanAfterValue,
  apiMaxRetries: 3,
  apiRetryIntervalMs: 2000,
  cdpMaxRetries: 2,
  cdpRetryIntervalMs: 5000,
  watchIntervalMs: 15000,
};

export async function processHead(deps = {}) {
  return processHeadCore({ ...defaultDeps, ...deps });
}

export async function runOnce(deps = {}) {
  const d = { ...defaultDeps, ...deps };
  if (!d.acquireLock()) {
    console.log('[worker] 另一进程持有锁，退出');
    return { processed: false, reason: 'locked' };
  }
  try {
    return await (d.processHead || processHead)(d);
  } finally {
    d.releaseLock();
  }
}

export async function runWatch(deps = {}) {
  const d = { ...defaultDeps, ...deps };
  console.log(`[worker] watch 模式启动，每 ${d.watchIntervalMs / 1000}s 检查队列`);
  while (true) {
    try {
      const q = await d.loadQueue();
      const pending = q.actions?.filter(a => !a.failed).length || 0;
      if (pending > 0) {
        console.log(`[worker] 队列待处理 ${pending} 条`);
        await runOnce(d);
      }
    } catch (e) {
      console.error('[worker] watch 异常:', e.message);
    }
    await new Promise(r => setTimeout(r, d.watchIntervalMs));
  }
}
