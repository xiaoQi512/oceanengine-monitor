// src/services/action-process-finalize.mjs - action 收尾与飞书反馈

export async function finalizeAction(d, result, head, planName, attempts) {
  const qLatest = await d.loadQueue();
  if (qLatest.actions?.length) {
    if (result?.ok) {
      qLatest.actions.shift();
      console.log(`[worker] ✅ 完成: ${head.type} "${planName}"，已出队`);
    } else {
      const failed = qLatest.actions.shift();
      failed.failed = true;
      failed.failedAt = new Date().toISOString();
      failed.lastError = result?.err || 'unknown';
      failed.attempts = attempts;
      qLatest.actions.push(failed);
      console.log(`[worker] ❌ 放弃: ${head.type} "${planName}"，标记 failed 并跳过`);
    }
    d.saveQueue(qLatest);
  }
  await d.reportToFeishu(head, result, planName);
}
