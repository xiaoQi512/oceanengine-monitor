// src/services/monitor-push.mjs - 15min 主飞书推送编排入口
import { findLarkCli, guardFeedbackServer, loadSuggestionHistory, saveSuggestionHistory, recalcSummary } from '../utils/monitor-utils.mjs';
import { pushCard } from '../feishu/guard.mjs';
import { shouldPush } from '../domain/push-logic.mjs';
import { PUSH_TYPES, loadLastPush, saveLastPush, appendPushLog } from './push-state.mjs';
import { recordPendingSuggestions } from './monitor-state.mjs';
import { loadBalanceAlertState, saveBalanceAlertState, loadAccountBudgetAlertState, saveAccountBudgetAlertState } from './alert-state.mjs';
import { sendBalanceAlert, sendAccountBudgetAlert } from './alert-push.mjs';
export { sendFeishuPush } from './monitor-push-send.mjs';

export function createPushDeps({ config, dryRun = false, buildFeishuCard, ...overrides } = {}) {
  const cardPusher = overrides.pushCard || pushCard;
  return {
    config,
    findLarkCli,
    dryRun,
    shouldPush,
    loadLastPush,
    saveLastPush,
    appendPushLog,
    PUSH_TYPES,
    buildFeishuCard,
    pushCard: cardPusher,
    guardFeedbackServer,
    recordPendingSuggestions,
    historyDeps: { loadSuggestionHistory, saveSuggestionHistory, recalcSummary },
    sendBalanceAlert,
    sendAccountBudgetAlert,
    alertStateDeps: {
      balance: { loadBalanceAlertState, saveBalanceAlertState, pushCard: cardPusher, config },
      budget: { loadAccountBudgetAlertState, saveAccountBudgetAlertState, pushCard: cardPusher, config },
    },
    ...overrides,
  };
}
