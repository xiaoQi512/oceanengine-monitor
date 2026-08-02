// src/services/five-min-push.mjs - 5min 快速速报推送
import { findLarkCli, FEISHU_CHAT_ID } from '../utils/monitor-utils.mjs';
import { pushCard } from '../feishu/guard.mjs';
import { buildQuickCard } from '../domain/quick-card.mjs';

export async function pushQuickReport({
  data,
  rolling,
  prevSnapshots = [],
  dryRun = false,
  pm2Prefix = '',
  now = '',
  chatId = FEISHU_CHAT_ID,
  deps = {},
} = {}) {
  const d = { findLarkCli, pushCard, buildQuickCard, ...deps };
  const larkCli = d.findLarkCli();
  if (!larkCli) {
    console.log('  ⚠ lark-cli 不可用');
    return false;
  }

  if (dryRun) {
    console.log('  🧪 OEC_DRY_RUN=1，跳过飞书推送');
    console.log(`  📋 将推送: 近${Math.round(rolling.last5minMinutes || 5)}分钟消耗 ¥${rolling.last5min.toFixed(0)}`);
    return false;
  }

  const card = d.buildQuickCard(data, rolling, prevSnapshots, {
    pm2Prefix,
    now,
  });

  const result = await d.pushCard(larkCli, card, chatId, {
    timeoutMs: 15000,
    maxRetries: 1,
    circuitFailureThreshold: 2,
    circuitFailureWindow: 4,
    circuitOpenDurationMs: 60_000,
  });

  if (result.ok) {
    console.log('  📨 5分钟速报已推送');
    return true;
  }
  console.log('  ❌ 推送异常:', result.error || 'unknown');
  if (result.fallback) console.log('  📁 已 fallback 到本地日志:', result.path);
  return false;
}
