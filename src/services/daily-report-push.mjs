// src/services/daily-report-push.mjs - 日报卡片推送
import { pushCard } from '../feishu/guard.mjs';

export async function pushDailyReportCard({
  larkCli,
  chatId,
  cardContent,
  pushCardFn = pushCard,
  logFn = console.log,
}) {
  if (!larkCli) {
    throw new Error('lark-cli 未找到，无法推送');
  }
  logFn('📤 推送日报卡片到飞书群...');
  const result = await pushCardFn(larkCli, JSON.parse(cardContent), chatId, {
    timeoutMs: 20000,
    maxRetries: 1,
    circuitFailureThreshold: 2,
    circuitFailureWindow: 4,
    circuitOpenDurationMs: 60_000,
  });
  if (result.ok) {
    logFn(`✅ 日报已推送到飞书群 (msg: ${result.result?.data?.message_id || 'unknown'})`);
    return true;
  }
  logFn(`❌ 推送失败: ${result.error || 'unknown'}`);
  if (result.fallback) {
    logFn(`📁 已 fallback 到本地日志: ${result.path}`);
  }
  throw new Error(`推送失败: ${result.error || 'unknown'}`);
}
