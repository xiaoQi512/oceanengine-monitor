// src/domain/report-html-rows.mjs - 报表计划/增量行
import { escHtml, parsePlanBudget } from './helpers.mjs';

export function buildAllPlanRows(planList = [], summary = {}) {
  return planList.sort((a, b) => b.spend - a.spend).map(c => {
    const planBudget = parsePlanBudget(c.budget);
    const capPct = planBudget > 0 ? (c.spend / planBudget * 100) : 0;
    const capStyle = capPct >= 100 ? 'color:#e74c3c;font-weight:bold' : capPct >= 80 ? 'color:#e67e22;font-weight:bold' : '';
    const cpaColor = c.cpa > (summary.avgCPA || 100) * 1.5 ? '#e74c3c' : c.cpa > (summary.avgCPA || 100) * 1.2 ? '#e67e22' : '#27ae60';
    const lcStage = c._lifecycle || 'unknown';
    const lcEmoji = { cold_start: '🔥', active: '🔥', declining: '📉', dead: '💀' }[lcStage] || '🔥';
    let statusDisplay = c.status || '';
    if (statusDisplay.includes('启用中') || statusDisplay.includes('投放中')) statusDisplay = '投放中';
    else if (statusDisplay.includes('超出预算')) statusDisplay = '未投放(超出预算)';
    else if (statusDisplay.includes('暂停')) statusDisplay = '未投放(已暂停)';
    const statusColor = statusDisplay === '投放中' ? '#10b981' : '#94a3b8';
    return `<tr>
      <td style="max-width:160px" title="${escHtml(c.name)}">${escHtml(c.name.slice(0, 28))}<br><span style="color:#888;font-size:10px">ID:${(c.id||'').slice(-10)}</span></td>
      <td><span style="color:${statusColor};font-size:11px">${statusDisplay}</span></td>
      <td style="font-weight:bold">¥${c.spend.toFixed(0)}</td>
      <td style="font-weight:bold;color:${cpaColor}">¥${(c.cpa||0).toFixed(0)}</td>
      <td>${c.conversions||0}</td>
      <td style="color:${(c.leads||0) !== (c.conversions||0) ? '#e67e22' : '#64748b'}">${c.leads||0}</td>
      <td>${c.privateMsgRetain||0}</td>
      <td>${c.formSubmit||0}</td>
      <td>${c.privateMsgOpen||0}</td>
      <td>${(c.ctr*100).toFixed(2)}%</td>
      <td>${(c.cvr*100).toFixed(2)}%</td>
      <td style="${capStyle}">${planBudget > 0 ? '¥'+planBudget.toFixed(0)+' ('+capPct.toFixed(0)+'%)' : 'N/A'}</td>
      <td><span title="${lcStage}">${lcEmoji}</span></td>
    </tr>`;
  }).join('');
}

export function buildCampaignRows(topNewSpenders = [], summary = {}, delta = {}) {
  return topNewSpenders.map(c => {
    const trendTag = c.trend === '起量' ? '<span class="badge bg-green">起量</span>' : c.trend === '稳定消耗' ? '<span class="badge bg-green">稳定</span>' : '';
    const planBudget = parsePlanBudget(c.budget);
    const capPct = planBudget > 0 ? (c.spend / planBudget * 100) : 0;
    const capStyle = capPct >= 100 ? 'color:#e74c3c;font-weight:bold' : capPct >= 80 ? 'color:#e67e22;font-weight:bold' : '';
    return `<tr>
      <td style="max-width:170px">${escHtml(c.name)}<br><span style="color:#888;font-size:11px">ID:${(c.id||'').slice(-8)}</span></td>
      <td>${c.trend} ${trendTag}</td>
      <td style="font-weight:bold">¥${c.spend.toFixed(2)}</td>
      <td style="color:${c.spendDelta>=0?'#e74c3c':'#27ae60'}">¥${(c.spendDelta||0).toFixed(2)}</td>
      <td style="color:${c.changeRate>=0?'#e74c3c':'#27ae60'}">${(c.changeRate>=0?'+':'')}${((c.changeRate||0)*100).toFixed(0)}%</td>
      <td>${c.conversions||0}</td>
      <td style="font-weight:bold;color:${c.cpa > summary.avgCPA * 1.3 ? '#e74c3c' : '#27ae60'}">¥${(c.cpa||0).toFixed(2)}${c.cpa15 > 0 ? `<br><span style="font-size:0.85em;color:#888">${Math.round(delta.age15||15)}m: ¥${c.cpa15.toFixed(2)}</span>` : ''}</td>
      <td style="${capStyle}">${planBudget > 0 ? capPct.toFixed(0)+'%' : 'N/A'}</td>
    </tr>`;
  }).join('');
}
