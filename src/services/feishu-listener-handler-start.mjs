// src/services/feishu-listener-handler-start.mjs - 监听/暂停/加预算处理器
import { acknowledgeStart } from './feishu-listener-queue.mjs';

export async function handleInfo(chatId, d) {
  const q = d.loadQueue();
  const pending = q.actions?.filter(a => !a.failed).length || 0;
  const failed = q.actions?.filter(a => a.failed).length || 0;
  await d.sendMsg(chatId, `ℹ️ 监听中。队列 ${pending} 条待处理，${failed} 条失败。\n指令: 暂停/关停/加预算/恢复/拒绝/执行/状态\n(执行后由 worker 串行处理)`);
}

export async function handlePauseResume(chatId, type, planName, by, d) {
  if (!planName) {
    const usage = type === 'pause' ? '暂停 「计划名」' : type === 'stop' ? '关停 「计划名」' : '恢复 「计划名」';
    await d.sendMsg(chatId, `⚠️ 未指定计划名。用法: ${usage}`);
    return;
  }
  const action = { type, planName, source: 'feishu', by };
  await acknowledgeStart(chatId, action, d.ACTION_TEXT[type] || type, d);
}

export async function handleBudget(chatId, planName, amount, by, d) {
  if (!planName || !amount || amount <= 0) {
    await d.sendMsg(chatId, '⚠️ 未指定计划名或金额。用法: 加预算 「计划名」 8000');
    return;
  }
  const action = { type: 'adjust_budget', planName, amount, source: 'feishu', by };
  await acknowledgeStart(chatId, action, '加预算', d);
}
