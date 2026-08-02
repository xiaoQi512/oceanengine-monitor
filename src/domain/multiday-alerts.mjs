// src/domain/multiday-alerts.mjs - 多日告警聚合入口
import { buildSpendAlerts } from './multiday-spend-alerts.mjs';
import { buildQualityAlerts } from './multiday-quality-alerts.mjs';
export { buildCompoundRiskAlert } from './multiday-compound.mjs';

export function buildMultiDayAlerts(params) {
  return [
    ...buildSpendAlerts(params),
    ...buildQualityAlerts(params),
  ];
}
