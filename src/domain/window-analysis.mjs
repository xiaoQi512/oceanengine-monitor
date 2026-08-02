// src/domain/window-analysis.mjs - 3小时窗口对比分析（纯逻辑）

export function analyze3HourWindowFromLog(log, now = Date.now()) {
  if (!log || log.length < 3) return null;

  const recent = log.filter(e => {
    const t = new Date(e.time).getTime();
    return (now - t) <= 180 * 60 * 1000;
  });

  if (recent.length < 2) return null;

  const oldestTime = new Date(recent[0].time).getTime();
  const newestTime = new Date(recent[recent.length - 1].time).getTime();
  const midTime = (oldestTime + newestTime) / 2;
  const firstHalf = recent.filter(e => new Date(e.time).getTime() <= midTime);
  const secondHalf = recent.filter(e => new Date(e.time).getTime() > midTime);

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const deltaSpend = arr => {
    if (arr.length < 2) return 0;
    return (arr[arr.length - 1].totalSpend || 0) - (arr[0].totalSpend || 0);
  };
  const deltaConv = arr => {
    if (arr.length < 2) return 0;
    return (arr[arr.length - 1].totalConversions || 0) - (arr[0].totalConversions || 0);
  };
  const deltaHours = arr => {
    if (arr.length < 2) return 0.25;
    return Math.max((new Date(arr[arr.length - 1].time).getTime() - new Date(arr[0].time).getTime()) / 3600000, 0.25);
  };

  const firstSpendDelta = deltaSpend(firstHalf);
  const secondSpendDelta = deltaSpend(secondHalf);
  const firstSpeedAvg = avg(firstHalf.map(e => e.speedCurrent || 0));
  const secondSpeedAvg = avg(secondHalf.map(e => e.speedCurrent || 0));
  const firstCPA = avg(firstHalf.map(e => e.avgCPA || 0).filter(v => v > 0));
  const secondCPA = avg(secondHalf.map(e => e.avgCPA || 0).filter(v => v > 0));

  const speedChange = firstSpeedAvg > 0 ? (secondSpeedAvg - firstSpeedAvg) / firstSpeedAvg : 0;
  const cpaChange = firstCPA > 0 ? (secondCPA - firstCPA) / firstCPA : 0;

  const firstConvDelta = deltaConv(firstHalf);
  const secondConvDelta = deltaConv(secondHalf);
  const firstConvRate = firstSpendDelta > 0 ? firstConvDelta / firstSpendDelta * 1000 : 0;
  const secondConvRate = secondSpendDelta > 0 ? secondConvDelta / secondSpendDelta * 1000 : 0;
  const convRateChange = firstConvRate > 0 ? (secondConvRate - firstConvRate) / firstConvRate : 0;

  const firstHours = deltaHours(firstHalf);
  const secondHours = deltaHours(secondHalf);
  const firstBurnRate = firstSpendDelta / firstHours;
  const burnRate = secondSpendDelta / secondHours;

  return {
    sampleCount: recent.length,
    windowHours: deltaHours(recent).toFixed(1),
    firstHours: firstHours.toFixed(1),
    secondHours: secondHours.toFixed(1),
    speed: { first: firstSpeedAvg, second: secondSpeedAvg, change: speedChange },
    cpa: { first: firstCPA || 0, second: secondCPA || 0, change: cpaChange },
    spend: { first: firstSpendDelta, second: secondSpendDelta, change: firstSpendDelta > 0 ? (secondSpendDelta - firstSpendDelta) / firstSpendDelta : 0 },
    convRate: { first: firstConvRate, second: secondConvRate, change: convRateChange },
    burnRate: { first: firstBurnRate, second: burnRate, change: firstBurnRate > 0 ? (burnRate - firstBurnRate) / firstBurnRate : 0 },
    conversions: { first: firstConvDelta, second: secondConvDelta },
  };
}
