// src/services/five-min-detailed-push.mjs - 5min 详细卡片推送
import {
  findLarkCli,
  FEISHU_CHAT_ID,
  getLiveWindowLabel,
  getTodayShiftWindow,
  minutesBetween,
} from '../utils/monitor-utils.mjs';
import { createClient as defaultCreateApiClient, collectAllData, getHourlyStats } from './api-client.mjs';
import { pushCard } from '../feishu/guard.mjs';
import { calcRolling as calculateRolling } from '../domain/rolling.mjs';
import { buildDetailedCard } from '../domain/detailed-card.mjs';
import { loadRecent5minSnapshots } from './five-min-snapshot.mjs';
import { buildDetailedCardContext } from './five-min-detailed-context.mjs';

function defaultCalcRolling(data, prevSnapshots) {
  return calculateRolling(data, prevSnapshots, {
    minutesBetween,
    now: new Date().toISOString(),
  });
}

export async function pushDetailedCard({
  dryRun = false,
  pm2Prefix = '',
  chatId = FEISHU_CHAT_ID,
  deps = {},
} = {}) {
  const d = {
    findLarkCli,
    createApiClient: defaultCreateApiClient,
    collectAllData,
    getHourlyStats,
    loadRecent5minSnapshots,
    getLiveWindowLabel,
    getTodayShiftWindow,
    minutesBetween,
    calcRolling: defaultCalcRolling,
    buildDetailedCard,
    pushCard,
    ...deps,
  };

  const larkCli = d.findLarkCli();
  if (!larkCli) {
    console.log('  ⚠ lark-cli 不可用，跳过详细卡片');
    return false;
  }
  if (dryRun) {
    console.log('  🧪 OEC_DRY_RUN=1，跳过详细卡片推送');
    return false;
  }

  console.log('  📡 拉取完整数据...');
  const apiClient = await d.createApiClient({ useCache: true });
  const allData = await d.collectAllData(apiClient);
  if (!allData || !allData.campaigns) {
    console.log('  ❌ 数据采集失败');
    return false;
  }

  const detailedCard = d.buildDetailedCard(await buildDetailedCardContext({ allData, apiClient, pm2Prefix, d }));
  const result = await d.pushCard(larkCli, detailedCard, chatId, {
    timeoutMs: 20000,
    maxRetries: 1,
    circuitFailureThreshold: 2,
    circuitFailureWindow: 4,
    circuitOpenDurationMs: 60_000,
  });
  if (result.ok) {
    console.log('  📨 15分钟详细卡片已推送');
    return true;
  }
  console.log('  ❌ 详细卡片推送异常:', result.error || 'unknown');
  return false;
}
