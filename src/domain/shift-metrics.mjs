// src/domain/shift-metrics.mjs - 换班数据指标计算（纯逻辑）

export function computeShiftCpl(totalConsume, totalLeads) {
  return totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';
}

export function normalizeShiftData(shiftData) {
  if (!shiftData) return null;
  const totalConsume = shiftData.spend;
  const totalLeads = shiftData.leads;
  return {
    totalConsume,
    totalLeads,
    cpl: computeShiftCpl(totalConsume, totalLeads),
  };
}

export function shouldSkipShift(totalConsume) {
  return totalConsume <= 0;
}
