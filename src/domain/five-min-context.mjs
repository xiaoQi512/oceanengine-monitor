// src/domain/five-min-context.mjs - 5min 详细卡片指标上下文
import { computeContextMetrics } from './five-min-context-metrics.mjs';
import { buildContextTrendLines, buildContextYesterdayLines, buildContextTopLines } from './five-min-context-trends.mjs';
import { computeContextPacing } from './five-min-context-pacing.mjs';

export async function buildDetailedCardContext({ allData, apiClient, pm2Prefix, d }) {
  const m = computeContextMetrics(allData, d);
  const liveWin = d.getLiveWindowLabel();
  const shift = d.getTodayShiftWindow();
  const now = new Date();
  const pacing = computeContextPacing({ shift, spend: m.spend, budget: m.budget, now });
  const { timeElapsedH, timeTotalH, timePct, budgetPct, projectedDaily, remainingH, daysRemaining, pacingHealth, headerColor } = pacing;
  const fakeData = { accountSpend: m.spend, summarySpend: m.spend, totalConv: m.totalConversions, summaryConv: m.totalConversions, activeCount: m.activeCampaigns.length, accountBudget: m.budget, accountBalance: m.balance, time: new Date().toISOString() };
  const rolling = d.calcRolling(fakeData, m.recentSnaps);
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  let snapshot15m = null;
  for (let i = m.recentSnaps.length - 1; i >= 0; i--) {
    if (m.recentSnaps[i].impressions > 0 && m.recentSnaps[i].time < fifteenMinAgo) { snapshot15m = m.recentSnaps[i]; break; }
  }
  const spend15m = snapshot15m ? m.spend - (snapshot15m.accountSpend || snapshot15m.summarySpend || 0) : rolling.last5min;
  const imp15m = snapshot15m ? m.totalImpressions - snapshot15m.impressions : m.near5mImpressions;
  let deltaRetention = m.viewRetention;
  if (snapshot15m && snapshot15m.liveViews > 0 && snapshot15m.liveOver1Min > 0) {
    const dViews = m.totalLiveViews - snapshot15m.liveViews;
    const dOver1Min = m.totalLiveOver1Min - snapshot15m.liveOver1Min;
    if (dViews > 0) deltaRetention = (dOver1Min / dViews) * 100;
  }
  const snapMinutes = snapshot15m ? Math.round(d.minutesBetween(snapshot15m.time, new Date().toISOString())) : 15;
  const snapConv = snapshot15m ? m.totalConversions - (snapshot15m.totalConv || 0) : rolling.convLast5min;
  const snapSpeed = snapMinutes > 0 ? spend15m / snapMinutes : 0;
  const trendLines = buildContextTrendLines(rolling);
  const yesterdayLines = await buildContextYesterdayLines({ apiClient, d, shift, spend: m.spend, avgCPA: m.avgCPA, now });
  const topLines = buildContextTopLines(m.campaigns);
  return {
    pm2Prefix, nowLocale: new Date().toLocaleString('zh-CN'), timeSlot: shift ? liveWin.labelCompact : '',
    timePct, timeElapsedH, timeTotalH, budgetPct, spend: m.spend, budget: m.budget, pacingHealth, projectedDaily, remainingH,
    avgCPA: m.avgCPA, totalConversions: m.totalConversions, totalPrivateMsgOpen: m.totalPrivateMsgOpen, openRetainRate: m.openRetainRate,
    snapMinutes, spend15m, snapConv, rolling, imp15m, avgCPM: m.avgCPM, totalLiveViews: m.totalLiveViews, deltaRetention, snapSpeed,
    spendingCount: m.spendingCampaigns.length, activeCount: m.activeCampaigns.length, rampingCount: m.rampingCount, droppingCount: m.droppingCount,
    balance: m.balance, daysRemaining, yesterdayLines, trendLines, topLines, headerColor,
  };
}
