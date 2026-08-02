// src/domain/plan-alerts.mjs - 计划/账户/趋势告警兼容入口
export { buildCampaignAlerts } from './plan-alerts-campaign.mjs';
export { buildAccountBudgetAlerts, buildBalanceAlerts } from './plan-alerts-account.mjs';
export { buildDroppingAlerts, buildTrendAlerts, buildDeadPlanAlerts } from './plan-alerts-trend.mjs';
