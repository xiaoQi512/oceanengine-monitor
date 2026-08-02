// src/domain/monitor-summary-header.mjs - 监控摘要页眉

export function buildMonitorSummaryHeaderLines(analysis) {
  const s = analysis.summary;
  const d = analysis.delta || {};
  const lines = ['\n╔══════════════════════════════════════╗', '║  📊 极狐-区域福利号-直播 监控摘要  ║', '╠══════════════════════════════════════╣', `║  有消耗: ${String(s.totalSpending).padStart(4)}  投放中: ${String(s.totalActive).padStart(3)}  起量: ${String((analysis.rampingUp||[]).length).padStart(3)}  掉量: ${String((analysis.dropping||[]).length).padStart(3)}  ║`];
  const statusStr = (s.statusLabels || []).map(l => `${l.label}${l.count}`).join(' ');
  if (statusStr) lines.push(`║  状态分布: ${statusStr.padEnd(49)}  ║`);
  lines.push(`║  总消耗: ¥${s.totalSpend.toFixed(0).padStart(12)}  (${s.spendSource === 'account' ? '账户' : s.spendSource === 'all_plans' ? '含暂停' : '仅活跃'})  ║`);
  lines.push(`║  ${Math.round(d.age15||15)}m新增: ¥${(d.spendLast15min||0).toFixed(0).padStart(10)}             ║`);
  lines.push(`║  总转化: ${String(s.totalConversions).padStart(6)}条  CPL: ¥${s.avgCPA.toFixed(2).padStart(8)}     ║`);
  lines.push(`║  近${Math.round(d.age15||15)}m: ${d.convLast15min === -1 ? '数据不足'.padStart(8) : String(d.convLast15min||0).padStart(4) + '条转化'}  ${d.convLast15min === -1 ? ''.padStart(10) : Math.round(d.age15||15)+'m CPL: ¥' + (d.cplLast15min||0).toFixed(2).padStart(8)}   ║`);
  return lines;
}
