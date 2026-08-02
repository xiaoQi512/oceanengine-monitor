// src/services/feishu-listener-handler-queue.mjs - 拒绝/执行队列处理器
import { findQueued, recordHistoryResponse } from './feishu-listener-queue.mjs';

export async function handleReject(chatId, planName, d) {
  const pending = d.findPending(chatId, planName);
  if (pending) {
    const item = pending.item;
    d.removePending(pending.data, pending.idx);
    if (new Date(item.expiresAt) < new Date()) {
      await d.sendMsg(chatId, '⏰ 该操作已超时取消，请重新发送指令');
    } else {
      await d.sendMsg(chatId, '⏹️ 已取消 ' + (d.ACTION_TEXT[item.action.type] || item.action.type) + '「' + item.action.planName + '」');
    }
    return;
  }
  const q = d.loadQueue();
  if (!q.actions?.length) {
    await d.sendMsg(chatId, 'ℹ️ 队列为空，无需拒绝');
    return;
  }
  const f = planName ? findQueued(planName, d) : { idx: 0, action: q.actions[0], queue: q };
  if (!f) {
    await d.sendMsg(chatId, `⚠️ 未在队列中找到「${planName}」`);
    return;
  }
  const rejectedPlan = f.action.planName;
  await d.sendMsg(chatId, `🔵 拒绝「${rejectedPlan}」\n   移除队列`);
  f.queue.actions.splice(f.idx, 1);
  d.saveQueue(f.queue);
  recordHistoryResponse(rejectedPlan, 'reject', d);
  await d.reportResult(chatId, true, 'reject', rejectedPlan, '已从队列移除');
}

export async function handleExecute(chatId, planName, amount, by, d) {
  const pending = d.findPending(chatId, planName);
  if (pending) {
    const item = pending.item;
    if (new Date(item.expiresAt) < new Date()) {
      d.removePending(pending.data, pending.idx);
      await d.sendMsg(chatId, '⏰ 该操作已超时取消，请重新发送指令');
      return;
    }
    d.removePending(pending.data, pending.idx);
    const queueLen = await d.enqueue({ type: item.action.type, planName: item.action.planName, amount: item.action.amount || undefined, source: 'feishu', by });
    await d.sendMsg(chatId, '🔵 已确认执行 ' + (d.ACTION_TEXT[item.action.type] || item.action.type) + '「' + item.action.planName + '」\n   已入队 #' + queueLen + ' · 等待 worker 执行');
    return;
  }
  const q = d.loadQueue();
  if (!planName && !q.actions?.length) {
    await d.sendMsg(chatId, '⚠️ 未指定计划名，且队列为空。\n用法: 执行（后跟计划名）/ 暂停 计划名 / 关停 计划名');
    return;
  }
  const f = planName ? findQueued(planName, d) : { idx: 0, action: q.actions[0], queue: q };
  if (!f) {
    await d.sendMsg(chatId, `⚠️ 队列中未找到「${planName}」`);
    return;
  }
  const act = f.action.type || 'pause';
  const execPlan = f.action.planName;
  const actType = (act === 'adjust_budget' || act === 'budget') ? 'adjust_budget' : act;
  const actDetail = actType === 'adjust_budget' ? `→ ${f.action.amount || amount}` : '';
  await d.sendMsg(chatId, `🔵 执行「${execPlan}」 ${actDetail} 已采纳，等待 worker 执行`);
  f.action.accepted = true;
  f.action.acceptedAt = new Date().toISOString();
  f.queue.actions[f.idx] = f.action;
  d.saveQueue(f.queue);
  recordHistoryResponse(execPlan, 'accept', d);
  await d.reportResult(chatId, true, actType, execPlan, '已采纳，等待 worker 执行');
}
