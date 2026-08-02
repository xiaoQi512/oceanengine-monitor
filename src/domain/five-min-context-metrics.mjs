// src/domain/five-min-context-metrics.mjs - 5min 上下文基础指标

export function computeContextMetrics(allData, d) {
  const campaigns = allData.campaigns;
  const pageSummary = allData.pageSummary || {};
  const spend = allData.accountSpend || 0;
  const budget = allData.accountBudget || 60000;
  const balance = allData.accountBalance || 0;
  const totalConversions = pageSummary.conversions || 0;
  const totalPrivateMsgOpen = pageSummary.privateMsgOpen || 0;
  const totalPrivateMsgRetain = pageSummary.privateMsgRetain || 0;
  const totalLiveViews = pageSummary.liveViews || pageSummary.liveEnter || 0;
  const totalLiveOver1Min = pageSummary.liveOneMin || pageSummary.liveOver1Min || 0;
  const avgCPM = pageSummary.cpm || campaigns.reduce((s, c) => s + (c.cpm || 0), 0) / Math.max(campaigns.length, 1) || 0;
  const avgCPA = totalConversions > 0 ? spend / totalConversions : 0;
  const totalImpressions = pageSummary.impressions || 0;
  const activeCampaigns = campaigns.filter(c => c.status === '投放中' || c.rawStatus === '启用' || c.rawStatus === '投放中');
  const spendingCampaigns = campaigns.filter(c => c.spend > 0);
  const recentSnaps = d.loadRecent5minSnapshots(6);
  const lastImpSnap = recentSnaps.find(s => s.impressions > 0);
  const near5mImpressions = lastImpSnap && totalImpressions > lastImpSnap.impressions ? totalImpressions - lastImpSnap.impressions : 0;
  let rampingCount = 0, droppingCount = 0;
  if (recentSnaps.length >= 2) {
    const prevSpending = recentSnaps[recentSnaps.length - 1].spendingCount || 0;
    const currSpending = spendingCampaigns.length;
    if (currSpending > prevSpending) rampingCount = currSpending - prevSpending;
    if (currSpending < prevSpending) droppingCount = prevSpending - currSpending;
  }
  const openRetainRate = totalPrivateMsgOpen > 0 ? ((totalPrivateMsgRetain / totalPrivateMsgOpen) * 100) : 0;
  const viewRetention = totalLiveViews > 0 ? ((totalLiveOver1Min / totalLiveViews) * 100) : 0;
  return { campaigns, spend, budget, balance, totalConversions, totalPrivateMsgOpen, totalPrivateMsgRetain, totalLiveViews, totalLiveOver1Min, avgCPM, avgCPA, totalImpressions, activeCampaigns, spendingCampaigns, recentSnaps, near5mImpressions, rampingCount, droppingCount, openRetainRate, viewRetention };
}
