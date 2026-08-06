// src/domain/action-result.mjs - action 结果归一与审计（纯逻辑）

export function pickAfterValue(result) {
  if (!result?.ok) return null;
  if (result.freshData) return result.freshData;
  if (result.newBudget != null) return { budget: result.newBudget };
  if (result.newBid != null) return { bid: result.newBid };
  if (result.state) return result.state;
  return null;
}

export function validateActionResult({
  actionType,
  beforeValue,
  afterValue,
  result,
  expectedValue,
}) {
  if (!result?.ok) return { passed: false, detail: result?.err || result?.error || '执行失败' };
  if (!afterValue) return { passed: false, detail: '缺少执行后数据，无法校验' };
  const before = beforeValue || {};
  const after = afterValue || {};
  const beforeStatus = String(before.status || '');
  const afterStatus = String(after.status || '');
  if (actionType === 'pause' || actionType === 'stop') {
    const passed = afterStatus.includes('暂停') || afterStatus.includes('已暂停') || afterStatus.includes('未投放');
    return {
      passed,
      detail: passed ? `状态已变更为 ${afterStatus}` : `状态未按预期变更：${beforeStatus || '-'} -> ${afterStatus || '-'}`,
    };
  }
  if (actionType === 'resume') {
    const passed = afterStatus.includes('投放中') || afterStatus.includes('启用') || afterStatus.includes('投放');
    return {
      passed,
      detail: passed ? `状态已变更为 ${afterStatus}` : `状态未按预期变更：${beforeStatus || '-'} -> ${afterStatus || '-'}`,
    };
  }
  if (actionType === 'adjust_budget') {
    const beforeBudget = Number(before.budget ?? beforeValue);
    const afterBudget = Number(after.budget ?? afterValue);
    const expected = expectedValue != null ? Number(expectedValue) : null;
    const passed = afterBudget > 0 && beforeBudget !== afterBudget && (expected == null || afterBudget === expected);
    return {
      passed,
      detail: `预算 ${beforeBudget} -> ${afterBudget}` + (passed ? '' : `，预期 ${expected ?? '变更'}，执行未通过校验`),
    };
  }
  if (actionType === 'adjust_bid') {
    const beforeBid = Number(before.bid ?? beforeValue);
    const afterBid = Number(after.bid ?? afterValue);
    const expected = expectedValue != null ? Number(expectedValue) : null;
    const passed = afterBid > 0 && beforeBid !== afterBid && (expected == null || afterBid === expected);
    return {
      passed,
      detail: `出价 ${beforeBid} -> ${afterBid}` + (passed ? '' : `，预期 ${expected ?? '变更'}，执行未通过校验`),
    };
  }
  return { passed: true, detail: '执行成功' };
}

export function buildActionAudit({
  head,
  beforeValue,
  afterValue,
  result,
  attempts,
  method,
  projectId,
}) {
  const validation = validateActionResult({
    actionType: head.type || '',
    beforeValue,
    afterValue,
    result,
    expectedValue: head.amount ?? head.bid,
  });
  return {
    traceRef: head.traceRef || '',
    actionType: head.type || '',
    planName: head.planName || head.plan || '',
    projectId: projectId || beforeValue?.projectId || head.projectId || '',
    reason: head.reason || head.source || head.by || '',
    beforeValue,
    afterValue,
    validation,
    result: {
      ok: result?.ok ?? false,
      method: result?.method || method || 'http_api',
      attempts,
      error: result?.err || result?.error || null,
    },
    source: head.source || 'feishu',
  };
}
