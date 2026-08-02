// src/domain/report-html-status.mjs - 报表告警/漏斗片段
import { escHtml } from './helpers.mjs';
import { shouldSuggest } from './suggestions.mjs';

export function buildAlertRows(alerts = [], history = {}) {
  if (alerts.length === 0) return '<tr><td colspan="6" style="text-align:center;color:#27ae60;padding:16px">✅ 消耗平稳，成本可控，无异常</td></tr>';
  return alerts.map(a => {
    const color = a.severity === 'high' ? '#e74c3c' : a.severity === 'medium' ? '#f39c12' : '#3498db';
    const label = a.severity === 'high' ? '⚠严重' : a.severity === 'medium' ? '⚡注意' : 'ℹ提示';
    const typeLabel = { speed: '消耗速度', cpa_rise: '成本上涨', budget: '预算', budget_cap: '计划撞线', account_budget_cap: '账户预算', zero_conv: '零转化', high_cpa: '高成本', dropping: '掉量', pacing_fast: '节奏过快', pacing_slow: '节奏落后' }[a.type] || a.type;
    const suppressed = (a.type === 'zero_conv' || a.type === 'high_cpa' || a.type === 'budget_cap') && !shouldSuggest(a.type, a.campaignId, history).suggest;
    return `<tr style="border-left:3px solid ${color}; ${suppressed ? 'opacity:0.5' : ''}">
      <td><span class="badge bg-${a.severity==='high'?'red':a.severity==='medium'?'yellow':'green'}">${typeLabel}</span> ${escHtml(a.name)}${suppressed ? ' <span style="font-size:10px;color:#999">(历史已抑制)</span>' : ''}</td>
      <td colspan="4">${escHtml(a.detail).replace(/\n/g, '<br>')}</td>
      <td><span style="color:${color};font-weight:bold">${label}</span></td>
    </tr>`;
  }).join('');
}

export function buildFunnelBar(val, label, color, maxFunnel) {
  const pct = maxFunnel > 0 ? (val / maxFunnel * 100) : 0;
  return `<div style="margin:4px 0;display:flex;align-items:center;gap:8px">
      <span style="width:80px;font-size:12px;text-align:right">${label}</span>
      <div style="flex:1;background:#f1f5f9;border-radius:6px;height:20px;overflow:hidden">
        <div style="width:${pct}%;background:${color};height:100%;border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding-right:8px">
          <span style="font-size:11px;color:#fff;font-weight:600">${val}</span>
        </div>
      </div>
      <span style="font-size:11px;color:#94a3b8;width:50px">${pct.toFixed(0)}%</span>
    </div>`;
}
