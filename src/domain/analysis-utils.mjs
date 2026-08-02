// src/domain/analysis-utils.mjs - 兼容聚合入口
export { buildCampaignIndex } from './campaign-index.mjs';
export { detectTrendsFromLog } from './trend-analysis.mjs';
export { computeYesterdayBaseline, computeMultiDayBaseline } from './baseline-analysis.mjs';
export { analyze3HourWindowFromLog } from './window-analysis.mjs';
export { computeLifecycleFromSnapshots } from './lifecycle-analysis.mjs';
