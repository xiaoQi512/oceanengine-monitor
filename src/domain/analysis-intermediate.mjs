// src/domain/analysis-intermediate.mjs - 历史/增量/速度中间指标
import { computePreviousTotals } from './analysis-previous.mjs';
import { buildCampaignDeltas } from './campaign-deltas.mjs';

export function buildIntermediateMetrics({ prev, useAccountSpend, avgCPA, totalSpend, active, prevIndex15 }) {
  const prevTotals = computePreviousTotals({ prev, useAccountSpend, avgCPA });
  const age15 = prev.t15?._ageMinutes || 15;
  const age60 = prev.t60?._ageMinutes || 60;
  let spendLast15min = prevTotals.prevTotal15 !== null ? totalSpend - prevTotals.prevTotal15 : 0;
  if (spendLast15min < 0) { console.log(`  ⚠️ spendLast15min 为负(${spendLast15min.toFixed(0)}), 可能跨天重置，清零增量`); spendLast15min = 0; }
  const speedCurrent = spendLast15min / Math.max(age15, 1);
  let spendLastHour = prevTotals.prevTotal15 !== null && prevTotals.prevTotal60 !== null ? (totalSpend - prevTotals.prevTotal60) : spendLast15min;
  if (spendLastHour < 0) spendLastHour = 0;
  const speedHour = spendLastHour / Math.max(age60, 1);
  const campaignDeltas = buildCampaignDeltas(active, prevIndex15);
  let convLast15min = 0, cplLast15min = 0;
  const prevAge = prev.t15?._ageMinutes || Infinity;
  if (prev.t15 && prevAge <= 35) {
    convLast15min = campaignDeltas.reduce((s, c) => s + (c.convDelta || 0), 0);
    cplLast15min = convLast15min > 0 ? spendLast15min / convLast15min : 0;
  } else { convLast15min = -1; console.log(`  ⚠ 近15分钟快照过旧(${prev.t15 ? `${prevAge.toFixed(0)}分钟前` : '无历史快照'})，跳过增量计算`); }
  const byNewSpend = [...campaignDeltas].sort((a, b) => b.spendDelta - a.spendDelta);
  const topNewSpenders = byNewSpend.slice(0, 8);
  const rampingUp = campaignDeltas.filter(c => c.trend === '起量').sort((a, b) => b.changeRate - a.changeRate);
  const dropping = campaignDeltas.filter(c => c.trend === '掉量').sort((a, b) => a.changeRate - b.changeRate);
  return { prevTotals, age15, age60, spendLast15min, spendLastHour, speedCurrent, speedHour, campaignDeltas, convLast15min, cplLast15min, topNewSpenders, rampingUp, dropping };
}
