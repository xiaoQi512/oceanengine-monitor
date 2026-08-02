// src/domain/trend-analysis.mjs - CPA/消耗趋势检测（纯逻辑）
import { computeLinearSlope } from './helpers.mjs';

export function detectTrendsFromLog(log) {
  if (!log || log.length < 3) return { cpaTrend: null, spendTrend: null };

  const recent = log.slice(-8);
  const baseTime = recent.length > 0 ? new Date(recent[0].time).getTime() : 0;
  const cpaSeries = recent.map((e) => {
    const x = (new Date(e.time).getTime() - baseTime) / 60000;
    return { x, y: e.avgCPA || 0 };
  }).filter(p => p.y > 0);
  const spendSeries = recent.map((e) => {
    const x = (new Date(e.time).getTime() - baseTime) / 60000;
    return { x, y: e.speedCurrent || 0 };
  });

  const cpaSlope = computeLinearSlope(cpaSeries);
  const spendSlope = computeLinearSlope(spendSeries);

  const avgCPA = cpaSeries.length > 0 ? cpaSeries.reduce((s, p) => s + p.y, 0) / cpaSeries.length : 0;
  const avgSpeed = spendSeries.length > 0 ? spendSeries.reduce((s, p) => s + p.y, 0) / spendSeries.length : 0;

  const spanMinutes = recent.length > 1 ? (new Date(recent[recent.length - 1].time).getTime() - baseTime) / 60000 : 0;
  const cpaChangeRate = avgCPA > 0 && spanMinutes > 0 ? (cpaSlope * spanMinutes) / avgCPA : 0;
  const spendChangeRate = avgSpeed > 0 && spanMinutes > 0 ? (spendSlope * spanMinutes) / avgSpeed : 0;

  return {
    cpaTrend: cpaSeries.length >= 3 ? { slope: cpaSlope, changeRate: cpaChangeRate, periods: cpaSeries.length, spanMinutes } : null,
    spendTrend: spendSeries.length >= 3 ? { slope: spendSlope, changeRate: spendChangeRate, periods: spendSeries.length, spanMinutes } : null,
  };
}
