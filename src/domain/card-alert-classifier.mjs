// src/domain/card-alert-classifier.mjs - 卡片告警分类（纯逻辑）
import { shouldSuggest } from './suggestions.mjs';

export function classifyCardAlerts(alerts = [], history = {}) {
  const highAlerts = alerts.filter(a => a.severity === 'high');
  const midAlerts = alerts.filter(a => a.severity === 'medium');
  const actionAlerts = alerts.filter(a => {
    if (a.type !== 'zero_conv' && a.type !== 'high_cpa' && a.type !== 'budget_cap') return false;
    return shouldSuggest(a.type, a.campaignId, history).suggest;
  });
  const watchAlerts = alerts.filter(a => [
    'cpa_3h', 'speed_3h', 'conv_drop_3h', 'burn_accel_3h', 'cpa_vs_3d', 'spend_vs_3d',
    'conv_vs_3d', 'plan_count_drop', 'retain_rate_drop', 'cpm_spike', 'view_retention_drop',
    'conv_efficiency_drop', 'compound_risk', 'cpa_trend', 'spend_trend', 'account_budget_cap', 'balance_low',
  ].includes(a.type));
  const infoAlerts = alerts.filter(a => [
    'speed_spike', 'budget', 'pacing_fast', 'pacing_slow', 'dead_plan', 'dropping',
  ].includes(a.type));
  return { highAlerts, midAlerts, actionAlerts, watchAlerts, infoAlerts };
}

export function buildAlertLines(infoAlerts = []) {
  const lines = [];
  if (infoAlerts.length > 0) {
    lines.push('🔵 **节奏提醒**');
    for (const a of infoAlerts) {
      lines.push(`ℹ ${a.name}: ${a.detail}`);
    }
  }
  return lines;
}
