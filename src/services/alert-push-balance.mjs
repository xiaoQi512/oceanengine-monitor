// src/services/alert-push-balance.mjs - 余额专用告警推送
import { buildBalanceAlertCard } from './alert-cards.mjs';

export async function sendBalanceAlert(analysis, ctx) {
  const {
    loadBalanceAlertState,
    saveBalanceAlertState,
    pushCard,
    config,
  } = ctx;
  const balanceAlerts = analysis.alerts.filter(a => a.type === 'balance_low');
  if (balanceAlerts.length === 0) return false;

  const worst = balanceAlerts.reduce((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.severity] < order[b.severity] ? a : b;
  });
  const state = loadBalanceAlertState();
  const now = Date.now();
  const severityOrder = { high: 0, medium: 1, low: 2 };
  const currentLevel = severityOrder[worst.severity] ?? 2;
  const lastLevel = severityOrder[state.lastSeverity] ?? 3;
  if (currentLevel >= lastLevel && now - state.lastPush < 2 * 60 * 60 * 1000) {
    console.log(`  💳 余额告警抑制: 距上次同级别推送仅 ${((now - state.lastPush) / 60000).toFixed(0)} 分钟`);
    return false;
  }
  if (worst.severity === 'low' || !config.larkCli) return false;
  const d = analysis.delta || {};
  const daysRemaining = worst.daysRemaining || 0;
  const balanceCard = buildBalanceAlertCard({ analysis, worst, config, d });
  try {
    const pushResult = await pushCard(config.larkCli, balanceCard, config.feishuChatId, { timeoutMs: 15000, maxRetries: 2 });
    if (pushResult.ok) {
      saveBalanceAlertState({ lastPush: now, lastSeverity: worst.severity, balance: analysis.summary?.accountBalance, daysRemaining });
      console.log(`  💳 余额专用告警已推送 [${worst.severity}] · 余额 ¥${(analysis.summary?.accountBalance||0).toFixed(0)} · 约${daysRemaining.toFixed(1)}天`);
      return true;
    }
    console.log(`  ❌ 余额告警推送失败: ${pushResult.error}`);
  } catch (e) {
    console.log(`  ❌ 余额告警推送异常: ${e.message?.slice(0, 80)}`);
  }
  return false;
}
