// src/services/alert-push-budget.mjs - 账户日预算专用告警推送
import { buildAccountBudgetAlertCard } from './alert-cards.mjs';

export async function sendAccountBudgetAlert(analysis, ctx) {
  const {
    loadAccountBudgetAlertState,
    saveAccountBudgetAlertState,
    pushCard,
    config,
  } = ctx;
  const accountBudgetAlerts = analysis.alerts.filter(a => a.type === 'account_budget_cap');
  if (accountBudgetAlerts.length === 0) return false;
  const summary = analysis.summary || {};
  const accountSpend = summary.accountSpend || 0;
  const accountBudget = summary.accountBudget || 0;
  if (accountBudget <= 0) return false;
  const usedPct = accountSpend / accountBudget;
  const severity = usedPct >= 0.95 ? 'high' : usedPct >= 0.85 ? 'medium' : 'low';
  if (severity === 'low') return false;
  const state = loadAccountBudgetAlertState();
  const now = Date.now();
  const severityOrder = { high: 0, medium: 1, low: 2 };
  const currentLevel = severityOrder[severity] ?? 2;
  const lastLevel = severityOrder[state.lastSeverity] ?? 3;
  if (currentLevel >= lastLevel && now - state.lastPush < 60 * 60 * 1000) {
    console.log(`  💰 账户日预算告警抑制: 距上次同级别推送仅 ${((now - state.lastPush) / 60000).toFixed(0)} 分钟`);
    return false;
  }
  if (!config.larkCli) return false;
  const d = analysis.delta || {};
  const projectedDaily = d.projectedDaily || 0;
  const overSpend = projectedDaily > accountBudget ? projectedDaily - accountBudget : 0;
  const isCritical = severity === 'high';
  const accountBudgetCard = buildAccountBudgetAlertCard({
    analysis, config, d, severity, accountSpend, accountBudget, usedPct, projectedDaily, overSpend,
    isCritical, headerColor: isCritical ? 'red' : 'orange', statusIcon: isCritical ? '🔴' : '🟡', urgencyLabel: isCritical ? '⚠️ 立即追加预算' : '⚡ 尽快追加预算',
  });
  try {
    const pushResult = await pushCard(config.larkCli, accountBudgetCard, config.feishuChatId, { timeoutMs: 15000, maxRetries: 2 });
    if (pushResult.ok) {
      saveAccountBudgetAlertState({ lastPush: now, lastSeverity: severity, lastPct: usedPct, spend: accountSpend, budget: accountBudget, projected: projectedDaily });
      console.log(`  💰 账户日预算专用告警已推送 [${severity}] · 使用率 ${(usedPct*100).toFixed(0)}% · 预估 ¥${projectedDaily.toFixed(0)}`);
      return true;
    }
    console.log(`  ❌ 账户日预算告警推送失败: ${pushResult.error}`);
  } catch (e) {
    console.log(`  ❌ 账户日预算告警推送异常: ${e.message?.slice(0, 80)}`);
  }
  return false;
}
