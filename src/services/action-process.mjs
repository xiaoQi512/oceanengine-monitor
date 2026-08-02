// src/services/action-process.mjs - action 队首处理纯编排
// 依赖由调用方注入，默认依赖装配位于 action-worker-run.mjs
import { isUtf8Corrupted, buildCorruptedAudit } from '../domain/action-guard.mjs';
import { pickAfterValue, buildActionAudit } from '../domain/action-result.mjs';
import { runHttpApiAttempts, runCdpAttempts } from './action-process-steps.mjs';
import { finalizeAction } from './action-process-finalize.mjs';

export async function processHead(d) {
  const q = await d.loadQueue();
  if (!q.actions?.length) return { processed: false, reason: 'empty' };

  let skippedFailed = 0;
  while (q.actions.length && q.actions[0].failed) {
    q.actions.shift();
    skippedFailed++;
  }
  if (skippedFailed > 0) d.saveQueue(q);
  if (!q.actions.length) {
    return { processed: false, reason: 'all-failed-skipped' };
  }

  const head = q.actions[0];
  const planName = head.planName || head.plan || '';
  const auditAction = head.type || '';

  if (isUtf8Corrupted(planName)) {
    console.warn(`[worker] 计划名疑似 UTF-8 编码损坏，拒绝执行: ${planName}`);
    const reason = 'UTF8_CORRUPTED';
    d.writeAudit(buildCorruptedAudit({ head, reason }));
    const qCorrupted = await d.loadQueue();
    if (qCorrupted.actions?.length) {
      qCorrupted.actions.shift();
      d.saveQueue(qCorrupted);
    }
    await d.reportToFeishu(head, { ok: false, err: '计划名编码损坏（可能来自 curl），请用 Write 工具重新入队' }, planName);
    return { processed: true, ok: false, reason };
  }
  const beforeValue = await d.readPlanAfterValue(planName);

  let result = null;
  let attempts = 0;
  let method = 'none';

  const projectId = beforeValue?.projectId || head.projectId || '';
  const httpStep = await runHttpApiAttempts(d, head, planName, projectId);
  result = httpStep.result;
  attempts = httpStep.attempts;
  method = httpStep.method;

  if (!result?.ok) {
    console.log(`[worker] HTTP API ${projectId ? '全部失败' : '跳过'}，检查 CDP 降级可行性`);
    const chromeOk = await d.isChromeHealthy();
    if (!chromeOk) {
      console.log('[worker] CDP 熔断: Chrome 不可达，拒绝操作并存审计');
      d.writeAudit({
        traceRef: head.traceRef || '',
        actionType: auditAction,
        planName,
        projectId: projectId || beforeValue?.projectId || '',
        beforeValue,
        afterValue: null,
        result: { ok: false, method: 'none', attempts, error: 'HTTP_API_FAILED + CHROME_UNREACHABLE' },
        source: head.source || 'feishu',
      });
      const qUp1 = await d.loadQueue();
      if (qUp1.actions?.length) {
        const failed = qUp1.actions.shift();
        failed.failed = true;
        failed.failedAt = new Date().toISOString();
        failed.lastError = 'HTTP_API_FAILED + CHROME_UNREACHABLE';
        failed.attempts = 0;
        qUp1.actions.push(failed);
        d.saveQueue(qUp1);
      }
      await d.reportToFeishu(head, { ok: false, err: 'HTTP API 失败 + Chrome 不可达，已熔断跳过' }, planName);
      return { processed: true, ok: false, reason: 'CDP_UNREACHABLE' };
    }

    const cdpStep = await runCdpAttempts(d, head, planName, attempts);
    result = cdpStep.result;
    attempts = cdpStep.attempts;
    method = cdpStep.method;
  }

  let afterValue = null;
  if (result?.ok) {
    afterValue = pickAfterValue(result);
    if (!afterValue) {
      console.log('[worker] afterValue 缺失，调 API 回读:', planName);
      afterValue = await d.readPlanAfterValue(planName);
    }
  }
  d.writeAudit(buildActionAudit({
    head,
    beforeValue,
    afterValue,
    result,
    attempts,
    method,
    projectId: beforeValue?.projectId || head.projectId || '',
  }));

  await finalizeAction(d, result, head, planName, attempts);
  return { processed: true, ok: !!result?.ok, result, attempts };
}
