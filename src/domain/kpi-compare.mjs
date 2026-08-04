export function buildKpiCompare({ current = {}, yesterday = {}, compareDate = '' } = {}) {
  const buildMetric = (currentValue, yesterdayValue) => {
    const cur = Number(currentValue) || 0;
    const prev = Number(yesterdayValue) || 0;
    const hasCompare = cur > 0 && prev > 0;
    return {
      current: cur,
      yesterday: prev,
      hasCompare,
      deltaPct: hasCompare
        ? Number((((cur - prev) / prev) * 100).toFixed(1))
        : null,
    };
  };

  return {
    compareDate,
    compare: {
      spend: buildMetric(current.spend, yesterday.spend),
      speed: buildMetric(current.speed, yesterday.speed),
      leads: buildMetric(current.leads, yesterday.leads),
      cpl: buildMetric(current.cpl, yesterday.cpl),
      cpm: buildMetric(current.cpm, yesterday.cpm),
      budget: buildMetric(current.budget, yesterday.budget),
    },
  };
}
