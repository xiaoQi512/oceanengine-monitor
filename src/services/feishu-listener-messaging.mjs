// src/services/feishu-listener-messaging.mjs - listener 飞书消息收发
import { spawnSync } from 'node:child_process';
import { pushText } from '../feishu/guard.mjs';
import { findLarkCli } from '../utils/monitor-utils.mjs';
import { FEISHU_CHAT_ID, PROJECT_ROOT } from '../config/index.mjs';
import { buildReportResultMessage } from '../domain/feishu-message-format.mjs';

const DEFAULT_LARK_CLI = findLarkCli() || 'lark-cli';

export async function sendMsg(
  chatId,
  text,
  {
    defaultChatId = FEISHU_CHAT_ID,
    larkCli = DEFAULT_LARK_CLI,
    silent = process.env.OEC_SILENT === '1',
    pushTextFn = pushText,
  } = {},
) {
  const target = chatId || defaultChatId;
  if (!silent) console.log('  -->', text.replace(/\n/g, ' '));
  const r = await pushTextFn(larkCli, text, target, {
    timeoutMs: 15000,
    maxRetries: 1,
    circuitFailureThreshold: 2,
    circuitFailureWindow: 4,
    circuitOpenDurationMs: 60_000,
  });
  if (!r.ok) {
    console.error('[send] fail:', r.error);
    return false;
  }
  return true;
}

export function addReaction(
  messageId,
  emojiType = 'Get',
  {
    larkCli = DEFAULT_LARK_CLI,
    projectRoot = PROJECT_ROOT,
    silent = process.env.OEC_SILENT === '1',
    spawnSyncFn = spawnSync,
  } = {},
) {
  if (!messageId) return;
  try {
    const r = spawnSyncFn(larkCli, [
      'im', 'reactions', 'create',
      '--params', JSON.stringify({ message_id: messageId }),
      '--data', JSON.stringify({ reaction_type: { emoji_type: emojiType } }),
    ], { encoding: 'utf8', cwd: projectRoot, timeout: 10000, windowsHide: true });
    if (!silent) {
      const ok = JSON.parse(r.stdout || '{}')?.ok;
      if (!ok) console.error('[react]', r.stdout?.substring(0, 200));
    }
  } catch (e) {
    console.error('[react]', e.message);
  }
}

export async function fetchMessages(
  chatId,
  pageSize = 10,
  {
    larkCli = DEFAULT_LARK_CLI,
    projectRoot = PROJECT_ROOT,
    spawnSyncFn = spawnSync,
  } = {},
) {
  try {
    const r = spawnSyncFn(larkCli, [
      'im', '+chat-messages-list', '--chat-id', chatId,
      '--page-size', String(pageSize), '--sort', 'desc',
    ], { encoding: 'utf8', cwd: projectRoot, timeout: 10000, windowsHide: true });
    const out = (r.stdout || '').trim();
    if (!out) return [];
    const d = JSON.parse(out);
    return d?.ok ? (d?.data?.messages || []) : [];
  } catch (e) {
    console.error('[fetch]', e.message);
    return [];
  }
}

export async function reportResult(chatId, ok, action, planName, detail, errMsg, opts = {}) {
  const msg = buildReportResultMessage({ ok, action, planName, detail, errMsg });
  return sendMsg(chatId || undefined, msg, opts);
}
