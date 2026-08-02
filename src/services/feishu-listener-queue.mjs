// src/services/feishu-listener-queue.mjs - listener 队列预检与确认入队

export function recordHistoryResponse(planName, response, d) {
  try {
    const h = d.loadSuggestionHistory();
    const t = [...h.suggestions].reverse().find(s =>
      !s.response && (s.campaignName === planName
        || s.campaignName?.includes(planName)
        || planName?.includes(s.campaignName))
    );
    if (t) {
      t.response = response;
      t.responseTime = new Date().toISOString();
      d.recalcSummary(h);
      d.saveSuggestionHistory(h);
      return t.id;
    }
  } catch (e) {
    console.error('[history]', e.message);
  }
  return null;
}

export function findQueued(planName, d) {
  const q = d.loadQueue();
  const i = q.actions?.findIndex(a => a.planName === planName
    || a.planName?.includes(planName)
    || planName?.includes(a.planName));
  return i >= 0 ? { idx: i, action: q.actions[i], queue: q } : null;
}

export async function precheckAction(action, d) {
  try {
    const camps = await d.getCampaignList();
    if (!camps.length) return { ok: false, reason: '计划列表为空，无法预检查' };
    const target = camps.find(c => c.name?.includes(action.planName));
    if (!target) return { ok: false, reason: '未找到计划 ' + action.planName };
    if (action.type === 'pause' && target.status !== '启用')
      return { ok: false, reason: `计划已处于「${target.status}」状态，无需重复暂停` };
    if (action.type === 'resume' && target.status === '启用')
      return { ok: false, reason: '计划已在投放中，无需重复恢复' };
    return { ok: true, target };
  } catch (e) {
    return { ok: false, reason: '预检查失败: ' + e.message };
  }
}

export async function acknowledgeStart(chatId, action, typeText, d) {
  const precheck = await precheckAction(action, d);
  if (!precheck.ok) {
    await d.sendMsg(chatId, '⚠️ ' + precheck.reason);
    return null;
  }
  const duplicates = d.checkDuplicateToday(action);
  if (duplicates) {
    const count = duplicates.length;
    const last = duplicates[duplicates.length - 1];
    const lastTime = (last.time || '').slice(11, 19) || '未知';
    d.addPending(action, chatId, { isDuplicate: true, lastCount: count, lastTime });
    await d.sendConfirmCard(chatId, action, count, lastTime);
    return { status: 'pending_confirm', isDuplicate: true };
  }
  const queueLen = await d.enqueue(action);
  await d.sendMsg(chatId,
    '🔵 ' + typeText + '「' + action.planName + '」\n' +
    '   已入队 #' + queueLen + ' · 等待 worker 执行'
  );
  return { status: 'queued', position: queueLen };
}
