// src/domain/report-html-body-header.mjs - 报表页眉与卡片

export function buildReportHtmlHeader({ now, d, liveWin, summary, rampingUp, dropping }) {
  return `<div class="header">
  <h1>🔥 极狐-区域福利号-直播 · 投放实时监控</h1>
  <div class="sub">更新时间: ${now} | 时段: ${d.timeSlot || 'N/A'} | ${liveWin.labelCompact} | 有消耗 ${summary.totalSpending||0}条 · 投放中 ${summary.totalActive||0}条 · 起量 ${(rampingUp||[]).length} · 掉量 ${(dropping||[]).length} · 节奏 ${d.pacingHealth||'N/A'} | 活跃${d.lifecycle?.active||0}·死亡${d.lifecycle?.dead||0} | 离线快照</div>
</div>
<div class="cards">
  <div class="card"><div class="label">有消耗计划</div><div class="value blue pulse">${summary.totalSpending||0}</div><div class="subv">投放中 ${summary.totalActive||0} · 暂停 ${summary.totalSpending - summary.totalActive}</div></div>
  <div class="card"><div class="label">今日消耗${summary.useAccountSpend ? '<span style="font-size:10px;color:#10b981">●账户</span>' : ''}</div><div class="value red">¥${summary.totalSpend.toFixed(0)}</div><div class="subv">理想 ¥${(d.idealSpend||0).toFixed(0)} | ${Math.round(d.age15||15)}m +¥${(d.spendLast15min||0).toFixed(0)}</div></div>
  <div class="card"><div class="label">总转化 / CPL</div><div class="value green">${summary.totalConversions}</div><div class="subv">CPL ¥${summary.avgCPA.toFixed(0)}</div></div>
  <div class="card"><div class="label">近${Math.round(d.age15||15)}m CPL</div><div class="value ${d.cplLast15min > 0 ? (d.cplLast15min > summary.avgCPA * 1.3 ? 'red' : 'green') : 'blue'}">${d.convLast15min === -1 ? '—' : d.cplLast15min > 0 ? '¥' + d.cplLast15min.toFixed(0) : '—'}</div><div class="subv">${d.convLast15min === -1 ? '数据不足' : d.convLast15min > 0 ? d.convLast15min + '条转化' : '无新增转化'}</div></div>
  <div class="card"><div class="label">消耗速度</div><div class="value orange">¥${(d.speedCurrent||0).toFixed(0)}/min</div><div class="subv">预估今日 ¥${(d.projectedDaily||0).toFixed(0)}</div></div>
  <div class="card"><div class="label">预算使用</div><div class="value ${(d.budgetUsed||0)>0.85?'red':'green'}">${((d.budgetUsed||0)*100).toFixed(0)}%</div><div class="subv">节奏: ${d.pacingHealth||'N/A'}</div></div>
  <div class="card"><div class="label">开口留资率</div><div class="value blue">${(summary.openRetainRate ? (summary.openRetainRate*100).toFixed(1)+'%' : 'N/A')}</div><div class="subv">开${summary.totalPrivateMsgOpen||0}→留${summary.totalPrivateMsgRetain||0}</div></div>
  <div class="card"><div class="label">私信开口</div><div class="value" style="color:#8b5cf6">${summary.totalPrivateMsgOpen||0}</div><div class="subv">条</div></div>
  <div class="card"><div class="label">私信留资</div><div class="value" style="color:#3b82f6">${summary.totalPrivateMsgRetain||0}</div><div class="subv">条</div></div>
  <div class="card"><div class="label">表单提交</div><div class="value" style="color:#10b981">${summary.totalFormSubmit||0}</div><div class="subv">条</div></div>
  ${summary.accountBudget > 0 ? `<div class="card"><div class="label">账户预算</div><div class="value ${summary.accountSpend / summary.accountBudget > 0.85 ? 'red' : 'green'}">¥${summary.accountSpend ? summary.accountSpend.toFixed(0) : '0'} / ¥${summary.accountBudget.toFixed(0)}</div><div class="subv">使用率 ${summary.accountSpend ? ((summary.accountSpend / summary.accountBudget)*100).toFixed(0) : 0}%</div></div>` : ''}
</div>`;
}
