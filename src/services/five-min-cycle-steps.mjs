// src/services/five-min-cycle-steps.mjs - 5min 周期步骤
import { pad, timeStr, formatFiveMinSkipReason, formatFiveMinForceReason } from '../domain/five-min-cycle-log.mjs';

export function logRunDecision(runDecision, hour, minute, shiftWin) {
  if (!runDecision.run) {
    console.log('  ' + formatFiveMinSkipReason(runDecision.reason, { hour, minute, shiftWin }));
    return true;
  }
  if (runDecision.reason === 'force') console.log('  ' + formatFiveMinForceReason(hour, minute));
  return false;
}

export function applyFiveMinFixes({ data, prevSnapshots, correctConversionFallback, detectCdpZeroSpend }) {
  const convFix = correctConversionFallback(data, prevSnapshots);
  if (convFix.from) {
    console.log(`  🔧 转化数异常(0→${convFix.totalConv})，${data._method === 'cdp' ? 'CDP提取失败' : 'API数据回退'}，沿用最近有效值`);
    data.totalConv = convFix.totalConv;
  }
  const zeroSpend = detectCdpZeroSpend(data, prevSnapshots);
  if (zeroSpend.lastValid) {
    console.log(`  ⚠ CDP消耗异常归零(${zeroSpend.lastValid.accountSpend.toFixed(0)}→0)，跳过快照以保护环比基线; 转化=${data.totalConv || 0}`);
    data.accountSpend = zeroSpend.lastValid.accountSpend;
    data.summarySpend = zeroSpend.lastValid.accountSpend;
  }
  return { skipSnapshot: zeroSpend.skip, zeroSpend };
}

export async function pushFiveMinCycle({
  d,
  data,
  rolling,
  prevSnapshots,
  dryRun,
  pm2Prefix,
  dataDir,
}) {
  const lastPush = d.loadLastPushState({ dataDir });
  const pushDecision = d.shouldPushFiveMin({ lastPush, now: Date.now() });
  if (!pushDecision.push) {
    console.log(`  ⏭ 距上次5分钟推送仅 ${pushDecision.elapsedMinutes.toFixed(1)} 分钟，跳过`);
    return;
  }
  const pushNow = new Date();
  if (d.isQuarterHour(pushNow.getMinutes())) {
    console.log('  📊 整刻钟 — 推送15分钟详细卡片');
    await d.pushDetailedCard({ dryRun, pm2Prefix });
  } else {
    await d.pushQuickReport({ data, rolling, prevSnapshots, dryRun, pm2Prefix, now: timeStr() });
  }
  d.saveLastPushState({ dataDir, timestamp: Date.now() });
}
