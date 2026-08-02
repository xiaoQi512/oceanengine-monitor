// src/domain/daily-report-html-template.mjs - 日报 HTML 模板组合
import { DAILY_REPORT_HTML_STYLE } from './daily-report-html-style.mjs';
import { buildDailyReportHtmlBody } from './daily-report-html-body.mjs';
import { buildDailyReportHtmlScript } from './daily-report-html-script.mjs';

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function buildDailyReportHtml({ today, entries, gaps, metrics, now = new Date() }) {
  const {
    finalSpend = 0, finalConversions = 0, finalCPA = 0, effectiveBudget = 0, budgetPct = '0',
    totalAlerts = 0, totalLeads = 0, openRetainStr = 'N/A',
  } = metrics || {};
  const slotStats = {};
  for (const e of entries || []) {
    const slot = e.timeSlot || '未知';
    if (!slotStats[slot]) slotStats[slot] = { count: 0, spend: 0, alerts: 0 };
    slotStats[slot].count++;
    slotStats[slot].spend = Math.max(slotStats[slot].spend, num(e.totalSpend));
    slotStats[slot].alerts += num(e.alertCount);
  }
  const spendLabels = (entries || []).map(e => { const t = new Date(e.time); return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; });
  const spendData = (entries || []).map(e => num(e.totalSpend));
  const cpaData = (entries || []).map(e => num(e.avgCPA));
  const convData = (entries || []).map(e => num(e.totalConversions));
  const speedData = (entries || []).map(e => num(e.speedCurrent));
  const budgetData = (entries || []).map(e => num(e.budgetUsed) * 100);
  const slotNames = Object.keys(slotStats);
  const gapRows = Number(gaps) > 0 ? `<div class="section"><h2>⚠ 数据断层记录</h2><p>今日共 ${gaps} 次数据断层。</p></div>` : '';
  const slotRows = slotNames.map(s => `<tr><td>${escHtml(s)}</td><td>${slotStats[s].count}</td><td>¥${slotStats[s].spend.toLocaleString()}</td><td>${slotStats[s].alerts}</td></tr>`).join('');
  const body = buildDailyReportHtmlBody({ today, entriesLength: (entries || []).length, gaps, effectiveBudget, spendLabels, finalSpend, finalConversions, finalCPA, budgetPct, totalAlerts, totalLeads, openRetainStr, speedData, gapRows, slotRows, now });
  const script = buildDailyReportHtmlScript({ labels: spendLabels, spendData, cpaData, budgetData, convData, speedData });
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>巨量引擎 投放日报 ${today}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
${DAILY_REPORT_HTML_STYLE}
</head>
<body>
${body}
${script}
</body>
</html>`;
}
