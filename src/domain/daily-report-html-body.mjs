// src/domain/daily-report-html-body.mjs - 日报 HTML 正文

export function buildDailyReportHtmlBody({
  today,
  entriesLength,
  gaps,
  effectiveBudget,
  spendLabels,
  finalSpend,
  finalConversions,
  finalCPA,
  budgetPct,
  totalAlerts,
  totalLeads,
  openRetainStr,
  speedData,
  gapRows,
  slotRows,
  now,
}) {
  return `<div class="header">
  <h1>📊 巨量引擎 · 投放日报</h1>
  <div class="sub">
    日期: ${today} | 数据周期: ${spendLabels[0] || '--'} - ${spendLabels[spendLabels.length - 1] || '--'}
    | ${entriesLength} 个采样点${Number(gaps) > 0 ? ' · <span style="color:#e67e22">' + gaps + '次数据断层</span>' : ''}
    | 日预算 ¥${Number(effectiveBudget).toLocaleString()} | 16h直播(7-23)
  </div>
</div>
<div class="cards">
  <div class="card"><div class="label">最终消耗</div><div class="value ${Number(budgetPct) >= 90 ? 'red' : Number(budgetPct) >= 75 ? 'orange' : 'green'}">¥${Number(finalSpend).toLocaleString()}</div><div class="subv">日预算 ${budgetPct}%${Number(budgetPct) >= 90 ? ' ⚠ 接近上限' : ''}</div></div>
  <div class="card"><div class="label">总转化 / 平均CPA</div><div class="value blue">${finalConversions}</div><div class="subv">CPA ¥${Number(finalCPA).toFixed(0)}</div></div>
  <div class="card"><div class="label">线索数</div><div class="value blue">${totalLeads}</div><div class="subv">留存率 ${openRetainStr}</div></div>
  <div class="card"><div class="label">今日告警</div><div class="value ${Number(totalAlerts) > 10 ? 'red' : 'orange'}">${totalAlerts}</div><div class="subv">${entriesLength}次采样</div></div>
  <div class="card"><div class="label">数据完整性</div><div class="value green">${entriesLength}/${entriesLength + Number(gaps)}</div><div class="subv">${Number(gaps) > 0 ? '断层 ' + gaps + '次' : '完整记录'}</div></div>
  <div class="card"><div class="label">最高消耗速度</div><div class="value orange">¥${Math.max(...speedData, 0).toFixed(0)}/min</div><div class="subv">峰值时段</div></div>
</div>
<div class="chart-row">
  <div class="section"><h2>💵 消耗走势（全天）</h2><div class="chart-container"><canvas id="spendChart"></canvas></div></div>
  <div class="section"><h2>🎯 CPA 趋势</h2><div class="chart-container"><canvas id="cpaChart"></canvas></div></div>
</div>
<div class="chart-row">
  <div class="section"><h2>📊 预算消耗进度(%)</h2><div class="chart-container"><canvas id="budgetChart"></canvas></div></div>
  <div class="section"><h2>📈 转化数 & 消耗速度</h2><div class="chart-container"><canvas id="convChart"></canvas></div></div>
</div>
${gapRows}
<div class="section"><h2>⏱ 分时段汇总</h2>
<table><thead><tr><th>时段</th><th>采样次数</th><th>该时段终点消耗</th><th>告警数</th></tr></thead>
<tbody>${slotRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8">暂无分时段数据</td></tr>'}</tbody></table>
</div>
<div class="footer">
  WorkBuddy 自动生成 · ${today} · 巨量引擎 · 16h直播(7:00-23:00) · 日报在每天23:05自动生成
  <br>数据来源: monitor-data/daily-${today}.json · ${entriesLength}个有效采样点 · 生成时间: ${now.toLocaleString('zh-CN')}
</div>`;
}
