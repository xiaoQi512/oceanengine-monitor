// src/domain/report-html-history.mjs - 报表建议历史行

export function buildHistoryRows(history = {}) {
  return (history.suggestions || []).slice(-20).reverse().map(s => {
    const respIcon = s.response === 'accept' ? '✅' : s.response === 'reject' ? '❌' : '⏳';
    const typeLabel = { zero_conv: '暂停零转化', high_cpa: '关停高成本', budget_cap: '追加预算' }[s.alertType] || s.alertType;
    return `<tr>
      <td>${new Date(s.time).toLocaleString('zh-CN')}</td>
      <td>${typeLabel}</td>
      <td>${s.campaignName || '—'}</td>
      <td>${s.suggestion || '—'}</td>
      <td>${respIcon} ${s.response === 'accept' ? '采纳' : s.response === 'reject' ? '拒绝' : '待定'}</td>
    </tr>`;
  }).join('');
}
