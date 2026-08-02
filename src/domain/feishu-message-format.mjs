// src/domain/feishu-message-format.mjs - 飞书消息文本构建（纯逻辑）

const ACTION_TEXT_MAP = { pause: '暂停', stop: '关停', resume: '恢复', adjust_budget: '调整预算', reject: '拒绝' };

export function buildReportResultMessage({ ok, action, planName, detail, errMsg }) {
  const actionText = ACTION_TEXT_MAP[action] || action;
  let msg;
  if (ok) {
    msg = `✅ 执行完成: ${actionText}「${planName}」`;
    if (detail) msg += ` ${detail}`;
  } else {
    msg = `❌ 执行失败: ${actionText}「${planName}」`;
    if (errMsg) msg += ` — ${errMsg}`;
  }
  return msg;
}
