// src/domain/ai-diagnosis.mjs - AI 诊断建议引擎（纯逻辑）
// 原则：
//   1. 仅生成“诊断 + 参考建议”，不自动执行任何操作
//   2. 每条建议附带：依据、预期影响、风险、止损条件
//   3. 结合历史采纳/拒绝记录，自动抑制已被拒绝的类型或计划
import { shouldSuggest } from './suggestions.mjs';

// 告警类型 → 可能关联的历史操作类型
const ALERT_ACTION_TYPES = {
  zero_conv: ['pause', 'stop'],
  high_cpa: ['pause', 'stop', 'adjust_bid'],
  budget_cap: ['adjust_budget'],
  dead_plan: ['pause', 'stop'],
  pacing_slow: ['adjust_bid', 'resume'],
  pacing_fast: ['adjust_budget', 'pause'],
  balance_low: [],
  account_budget_cap: ['adjust_budget'],
  dropping: ['pause', 'stop'],
  cpa_trend: ['adjust_bid'],
  spend_trend: ['adjust_budget'],
};

const ACTION_DESCRIPTIONS = {
  zero_conv: {
    suggestion: '暂停观察',
    expectedImpact: '停止无效消耗，降低账户整体 CPL',
    risk: '若为延迟归因，可能误杀即将出量计划',
    stopLoss: '若后续恢复转化且 CPL 回落至均值以内，可重新开启',
  },
  high_cpa: {
    suggestion: '暂停或降低出价',
    expectedImpact: '控制高成本计划消耗，降低账户整体 CPL',
    risk: '可能损失潜在增量流量',
    stopLoss: '若出价降低后 CPL 回落至均值 1.2 倍以内，可继续观察',
  },
  budget_cap: {
    suggestion: '追加计划预算',
    expectedImpact: '避免计划撞线暂停，保持投放连续性',
    risk: '若当前转化效率不佳，追加预算会放大亏损',
    stopLoss: '追加后若连续 2 个窗口 CPL 高于均值 1.5 倍，应暂停',
  },
  dead_plan: {
    suggestion: '暂停低效计划',
    expectedImpact: '减少无效计划数量，释放预算给高潜计划',
    risk: '部分计划可能处于学习期或流量低谷',
    stopLoss: '若该计划在暂停后同类型新计划表现更差，可考虑恢复观察',
  },
  pacing_slow: {
    suggestion: '观察 30 分钟或小幅提价',
    expectedImpact: '若流量恢复则提升消耗速度；若持续低耗则避免浪费',
    risk: '提价可能抬高 CPL',
    stopLoss: '提价后 CPL 高于均值 1.3 倍或线索下降 10%，立即回滚',
  },
  pacing_fast: {
    suggestion: '控制预算或暂停部分非核心计划',
    expectedImpact: '降低预算撞线风险，避免后半场无预算可用',
    risk: '可能错过高峰流量',
    stopLoss: '若预算使用率回落至 80% 以下且转化效率正常，可维持',
  },
  balance_low: {
    suggestion: '立即充值或降低日预算',
    expectedImpact: '避免账户余额耗尽导致全部计划停投',
    risk: '充值后若市场环境变化，可能造成预算浪费',
    stopLoss: '充值后按新余额重新评估可支撑天数',
  },
  account_budget_cap: {
    suggestion: '追加账户预算或调整计划预算分配',
    expectedImpact: '避免账户预算撞线导致整体停投',
    risk: '若整体转化效率不佳，追加预算会放大亏损',
    stopLoss: '追加后若账户整体 CPL 高于目标 1.2 倍，应回退',
  },
  dropping: {
    suggestion: '观察素材/计划衰退情况',
    expectedImpact: '确认是否因素材衰退或流量波动导致掉量',
    risk: '过早暂停可能错过流量恢复',
    stopLoss: '若连续 1 小时消耗持续下降且无转化，可暂停',
  },
  cpa_trend: {
    suggestion: '检查近期素材与定向，必要时降低出价',
    expectedImpact: '抑制 CPL 持续走高趋势',
    risk: '降低出价可能导致量级下降',
    stopLoss: '若 CPL 连续 2 个窗口回落至均值以内，可恢复原出价',
  },
  spend_trend: {
    suggestion: '关注预算消耗速度，必要时设置预算上限',
    expectedImpact: '防止预算过早耗尽',
    risk: '限制消耗可能错失放量窗口',
    stopLoss: '若预算使用率超过 90% 且转化效率正常，可维持当前节奏',
  },
};

function findRelatedRule(rules, alertType, planName) {
  if (!Array.isArray(rules) || !planName) return null;
  // 尝试按投放形式 + 动作类型匹配
  for (const rule of rules) {
    const actionMatch = rule.action && (ALERT_ACTION_TYPES[alertType] || [alertType]).includes(rule.action);
    const deliveryMatch = rule.deliveryType && planName.includes(rule.deliveryType);
    if (actionMatch && deliveryMatch) return rule;
  }
  // 退化为仅按动作类型匹配
  return rules.find(r => r.action && (ALERT_ACTION_TYPES[alertType] || [alertType]).includes(r.action)) || null;
}

function buildEvidence(alert, analysis) {
  const evidence = [alert.detail || alert.name];
  const d = analysis?.delta || {};
  if (d.speedCurrent != null) evidence.push(`当前速度 ¥${d.speedCurrent.toFixed(1)}/min`);
  if (d.budgetUsed != null) evidence.push(`预算使用率 ${(d.budgetUsed * 100).toFixed(0)}%`);
  if (d.projectedDaily != null) evidence.push(`预估今日 ¥${d.projectedDaily.toFixed(0)}`);
  return evidence.filter(Boolean);
}

export function buildDiagnosisSuggestions({
  alerts = [],
  analysis = null,
  history = null,
  rules = [],
  now = new Date().toISOString(),
} = {}) {
  const suggestions = [];
  for (const alert of alerts) {
    const actionMeta = ACTION_DESCRIPTIONS[alert.type];
    if (!actionMeta) continue; // 只处理已知可诊断类型

    const campaignId = alert.campaignId || '';
    const campaignName = alert.planName || alert.name || '';
    const suggestCheck = shouldSuggest(alert.type, campaignId, history);
    if (!suggestCheck.suggest) continue;

    const relatedRule = findRelatedRule(rules, alert.type, campaignName);
    const suggestion = {
      id: `diag_${Date.now()}_${suggestions.length + 1}_${alert.type}`,
      time: now,
      alertType: alert.type,
      severity: alert.severity || 'medium',
      campaignId,
      campaignName,
      diagnosis: alert.detail || alert.name,
      suggestion: actionMeta.suggestion,
      expectedImpact: actionMeta.expectedImpact,
      risk: actionMeta.risk,
      stopLoss: actionMeta.stopLoss,
      evidence: buildEvidence(alert, analysis),
      relatedRule: relatedRule || null,
      suppressReason: suggestCheck.reason || '',
    };
    suggestions.push(suggestion);
  }
  return suggestions;
}

export function summarizeDiagnosis(suggestions) {
  const byType = {};
  for (const s of suggestions) {
    byType[s.alertType] = (byType[s.alertType] || 0) + 1;
  }
  return {
    total: suggestions.length,
    byType,
    highCount: suggestions.filter(s => s.severity === 'high').length,
    mediumCount: suggestions.filter(s => s.severity === 'medium').length,
  };
}

export default {
  buildDiagnosisSuggestions,
  summarizeDiagnosis,
};
