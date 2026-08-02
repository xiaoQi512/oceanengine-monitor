// src/domain/action-guard.mjs - action 编码与审计守卫（纯逻辑）

const UTF8_CORRUPTION_RE = /(\?{3,}|[\ufffd]{2,})/;

export function isUtf8Corrupted(value) {
  return UTF8_CORRUPTION_RE.test(String(value || ''));
}

export function buildCorruptedAudit({ head, reason = 'UTF8_CORRUPTED' }) {
  return {
    traceRef: head.traceRef || '',
    actionType: head.type || '',
    planName: head.planName || head.plan || '',
    projectId: head.projectId || '',
    beforeValue: null,
    afterValue: null,
    result: { ok: false, method: 'none', attempts: 0, error: reason },
    source: head.source || 'feishu',
  };
}
