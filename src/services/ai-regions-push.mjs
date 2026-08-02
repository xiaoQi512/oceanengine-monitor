// src/services/ai-regions-push.mjs - AI 区域飞书推送
import { execFileSync } from 'node:child_process';
import { findLarkCli, PROJECT_ROOT, FEISHU_ANCHOR_CHAT_ID } from '../utils/monitor-utils.mjs';

export function pushToLark(text, {
  findLarkCliFn = findLarkCli,
  chatId = FEISHU_ANCHOR_CHAT_ID,
  projectRoot = PROJECT_ROOT,
  execFileSyncFn = execFileSync,
  logFn = console.log,
} = {}) {
  const larkCli = findLarkCliFn();
  if (!larkCli) {
    logFn('  ⚠ lark-cli 不可用');
    return false;
  }
  const isExe = larkCli.endsWith('.exe');
  try {
    const out = execFileSyncFn(
      isExe ? larkCli : 'cmd.exe',
      isExe
        ? ['im', '+messages-send', '--chat-id', chatId, '--text', text, '--as', 'bot']
        : ['/c', larkCli, 'im', '+messages-send', '--chat-id', chatId, '--text', text, '--as', 'bot'],
      { encoding: 'utf-8', timeout: 20000, windowsHide: true, cwd: projectRoot }
    );
    const parsed = JSON.parse(out);
    if (parsed.ok) {
      logFn(`  ✅ 已推送: ${parsed.data?.message_id || 'ok'}`);
      return true;
    }
    logFn(`  ❌ 推送失败: ${parsed.error?.message || JSON.stringify(parsed)}`);
    return false;
  } catch (e) {
    logFn(`  ❌ 推送异常: ${e.message}`);
    return false;
  }
}
