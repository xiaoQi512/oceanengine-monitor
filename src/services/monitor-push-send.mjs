// src/services/monitor-push-send.mjs - 15min 主飞书推送执行

export async function sendFeishuPush(analysis, ctx) {
  const {
    config,
    findLarkCli,
    dryRun,
    shouldPush,
    loadLastPush,
    saveLastPush,
    appendPushLog,
    PUSH_TYPES,
    buildFeishuCard,
    pushCard,
    guardFeedbackServer,
    recordPendingSuggestions,
    historyDeps,
    sendBalanceAlert,
    sendAccountBudgetAlert,
    alertStateDeps,
  } = ctx;

  console.log(`  🔍 [诊断] larkCli=${config.larkCli ? config.larkCli.replace(/^.*[\\/]/, '') : '∅'} | hasData=${(analysis.summary?.totalSpend ?? 0) > 0 || (analysis.summary?.totalSpending ?? 0) > 0} | alerts=${analysis.alerts?.length ?? 0}`);

  if (!config.larkCli) {
    for (let retry = 0; retry < 2; retry++) {
      await new Promise(r => setTimeout(r, 1000));
      const retried = findLarkCli();
      if (retried) {
        config.larkCli = retried;
        console.log(`  🔄 lark-cli 重试${retry+1}次后找到: ${retried.replace(/^.*[\\/]/, '')}`);
        break;
      }
    }
    if (!config.larkCli) {
      console.log('  ⚠ lark-cli 不可用，跳过飞书推送 (findLarkCli 返回空，已重试2次)');
      return false;
    }
  }

  if (dryRun) {
    console.log('  🧪 OEC_DRY_RUN=1，跳过飞书推送');
    const cardObj = await buildFeishuCard(analysis);
    const preview = JSON.stringify(cardObj).slice(0, 200);
    console.log(`  📋 卡片预览: ${preview}...`);
    return false;
  }

  const check = shouldPush(analysis, { loadLastPush });
  if (!check.push) {
    console.log(`  📨 飞书推送跳过: ${check.reason}`);
    await sendBalanceAlert(analysis, alertStateDeps.balance);
    await sendAccountBudgetAlert(analysis, alertStateDeps.budget);
    return false;
  }

  await guardFeedbackServer();
  const cardObj = await buildFeishuCard(analysis);
  const pending = cardObj._pendingSuggestions || [];
  delete cardObj._pendingSuggestions;
  const pushResult = await pushCard(config.larkCli, cardObj, config.feishuChatId, {
    timeoutMs: 20000,
    maxRetries: 1,
    circuitFailureThreshold: 2,
    circuitFailureWindow: 4,
    circuitOpenDurationMs: 60_000,
  });

  if (pushResult.ok) {
    const levelTag = check.level === 1 ? '🔴严重' : '🟡中等';
    console.log(`  📨 飞书推送成功 [${levelTag} L${check.level}]`);
    saveLastPush({ timestamp: Date.now(), level: check.level });
    appendPushLog(PUSH_TYPES.MAIN, 'ok', `${levelTag} L${check.level}`, analysis);
    if (pending.length > 0) {
      recordPendingSuggestions(pending, historyDeps);
      console.log(`  📋 已记录 ${pending.length} 条待处理建议`);
    }
    await sendBalanceAlert(analysis, alertStateDeps.balance);
    await sendAccountBudgetAlert(analysis, alertStateDeps.budget);
    return true;
  }

  console.log(`  ❌ 飞书推送异常: ${pushResult.error || 'unknown'}`);
  appendPushLog(PUSH_TYPES.MAIN, 'fail', pushResult.error || 'unknown', analysis);
  if (pushResult.fallback) console.log(`  📁 已 fallback 到本地日志: ${pushResult.path}`);
  await sendBalanceAlert(analysis, alertStateDeps.balance);
  await sendAccountBudgetAlert(analysis, alertStateDeps.budget);
  return false;
}
