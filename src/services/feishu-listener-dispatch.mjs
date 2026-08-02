// src/services/feishu-listener-dispatch.mjs - listener 命令分发
import { FEISHU_CHAT_ID } from '../config/index.mjs';
import { loadSuggestionHistory, saveSuggestionHistory, recalcSummary } from '../utils/monitor-utils.mjs';
import { loadQueue, saveQueue, enqueue, addPending, findPending, removePending, checkDuplicateToday } from './feishu-listener-state.mjs';
import { sendMsg, reportResult } from './feishu-listener-messaging.mjs';
import { sendConfirmCard, ACTION_TEXT } from './feishu-listener-actions.mjs';
import { getCampaignList } from './feishu-listener-ai.mjs';
import { handleInfo, handleReject, handlePauseResume, handleBudget, handleExecute } from './feishu-listener-handlers.mjs';

const defaultDeps = {
  FEISHU_CHAT_ID,
  loadSuggestionHistory,
  saveSuggestionHistory,
  recalcSummary,
  loadQueue,
  saveQueue,
  enqueue,
  addPending,
  findPending,
  removePending,
  checkDuplicateToday,
  sendMsg,
  reportResult,
  sendConfirmCard,
  ACTION_TEXT,
  getCampaignList,
};

export async function dispatch(cmd, sender, chatId, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  if (!chatId) chatId = d.FEISHU_CHAT_ID;
  const { cmd: type, planName, amount } = cmd;
  const by = sender?.name || sender || 'unknown';

  if (type === 'info') {
    await handleInfo(chatId, d);
    return;
  }
  if (type === 'reject') {
    await handleReject(chatId, planName, d);
    return;
  }
  if (['pause', 'stop', 'resume'].includes(type)) {
    await handlePauseResume(chatId, type, planName, by, d);
    return;
  }
  if (type === 'adjust_budget') {
    await handleBudget(chatId, planName, amount, by, d);
    return;
  }
  if (type === 'execute') {
    await handleExecute(chatId, planName, amount, by, d);
    return;
  }
  await d.sendMsg(chatId, `ℹ️ 无法识别指令: ${cmd.raw}`);
}
