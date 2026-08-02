// src/domain/monitor-summary-body.mjs - 监控摘要正文

export function buildMonitorSummaryBodyLines(analysis) {
  const s = analysis.summary;
  const d = analysis.delta || {};
  const lines = [];
  if (analysis._window3h) {
    const s3h = analysis._window3h;
    const spdTag = s3h.speed.change > 0.3 ? '🔥' : s3h.speed.change < -0.3 ? '❄' : '➡';
    const cpaTag = s3h.cpa.change > 0.15 ? '📈' : s3h.cpa.change < -0.15 ? '📉' : '➡';
    lines.push(`║  3h波动: 速度${spdTag}${(s3h.speed.change>=0?'+':'')}${(s3h.speed.change*100).toFixed(0)}% | CPL${cpaTag}${(s3h.cpa.change>=0?'+':'')}${(s3h.cpa.change*100).toFixed(0)}% | 燃速${(s3h.burnRate.second/1000).toFixed(1)}k/h    ║`);
  }
  if (analysis._multiDay && analysis._multiDay.sampleDays >= 2) {
    const md = analysis._multiDay;
    lines.push(`║  近${md.sampleDays}天: 消耗${`vs均值${(md.spend.mean||0).toFixed(0)}`.padStart(14)} | CPL${md.cpa ? `vs均值${(md.cpa.mean||0).toFixed(0)}`.padStart(12) : ''}           ║`);
  }
  lines.push(`║  线索来源: 线索${String(s.totalLeads).padStart(4)} = 留资${String(s.totalPrivateMsgRetain||0).padStart(4)} + 表单${String(s.totalFormSubmit||0).padStart(4)} ≈ 转化${String(s.totalConversions).padStart(4)} ║`);
  const orrPct = s.openRetainRate ? (s.openRetainRate*100).toFixed(1)+'%' : 'N/A';
  lines.push(`║  开口留资率: ${orrPct.padStart(8)} (开${String(s.totalPrivateMsgOpen||0).padStart(3)}→留${String(s.totalPrivateMsgRetain||0).padStart(3)})       ║`);
  lines.push(`║  消耗速度: ¥${(d.speedCurrent||0).toFixed(1).padStart(8)}/min               ║`);
  lines.push(`║  预算使用: ${((d.budgetUsed||0)*100).toFixed(0).padStart(5)}%  (¥${(d.dailyBudget||45000).toFixed(0).padStart(7)})     ║`);
  if (s.accountBudget > 0) {
    const abPct = ((s.accountSpend||0) / s.accountBudget * 100).toFixed(0);
    lines.push(`║  账户预算: ¥${(s.accountSpend||0).toFixed(0).padStart(10)} / ¥${s.accountBudget.toFixed(0).padStart(8)} (${abPct}%) ║`);
  }
  if (s.accountBalance > 0) {
    const daysBal = d.projectedDaily > 0 ? (s.accountBalance / d.projectedDaily).toFixed(1) + '天' : '—';
    lines.push(`║  账户余额: ¥${s.accountBalance.toFixed(0).padStart(10)}  (约${daysBal})                  ║`);
  }
  lines.push(`║  节奏健康: ${(d.pacingHealth||'N/A').padStart(6)}  时段: ${(d.timeSlot||'N/A').padStart(8)}     ║`);
  lines.push(`║  告警数:  ${String(analysis.alerts.length).padStart(6)}                   ║`);
  const lc = d.lifecycle || {};
  lines.push(`║  生命周期: ${`🔥${lc.active||0} 💀${lc.dead||0}`.padEnd(30)}║`);
  lines.push('╚══════════════════════════════════════╝');
  return lines;
}
