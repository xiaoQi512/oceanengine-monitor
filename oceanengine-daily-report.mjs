// oceanengine-daily-report.mjs — 巨量引擎每日投放日报生成器
// 每天23:05触发，读取 daily-YYYY-MM-DD.json 全量日志生成HTML日报
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLocalDate, minutesBetween, DATA_DIR, ACCOUNT_NAME, DAILY_BUDGET } from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  accountName: ACCOUNT_NAME,
  dataDir: DATA_DIR,
  reportDir: __dirname,
  dailyBudget: DAILY_BUDGET,
};

function escHtml(str) { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
// 防止嵌入 script 时 JSON 中的 </script> 字符串破坏 HTML 结构
function escJsonForScript(obj) { return JSON.stringify(obj).replace(/<\/(script)/gi, '<\\/$1'); }

// 读取最近 N 天 daily 日志，用于跨日对比
function loadRecentDailyLogs(days = 7) {
  const results = [];
  const base = new Date();
  for (let i = 1; i <= days; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const file = path.join(CONFIG.dataDir, `daily-${dateStr}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      const log = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const entries = log.filter(e => !e.type || e.type !== 'data_gap');
      if (entries.length === 0) continue;
      const last = entries[entries.length - 1];
      results.push({ date: dateStr, finalSpend: last.totalSpend || 0, finalConversions: last.totalConversions || 0, finalCPA: (last.totalConversions || 0) > 0 ? (last.totalSpend || 0) / last.totalConversions : 0, totalLeads: last.totalLeads || 0, entries });
    } catch {}
  }
  return results.sort((a, b) => a.date.localeCompare(b.date));
}

function main() {
  const today = getLocalDate();
  const logFile = path.join(CONFIG.dataDir, `daily-${today}.json`);
  
  if (!fs.existsSync(logFile)) {
    console.log(`[${new Date().toLocaleTimeString()}] 无今日数据: ${logFile}`);
    process.exit(0);
  }
  
  let log;
  try { log = JSON.parse(fs.readFileSync(logFile, 'utf-8')); } catch {
    console.log(`[${new Date().toLocaleTimeString()}] 日志解析失败`);
    process.exit(1);
  }
  
  if (!log || log.length === 0) {
    console.log('无日志条目');
    process.exit(0);
  }
  
  const entries = log.filter(e => !e.type || e.type !== 'data_gap');
  const gaps = log.filter(e => e.type === 'data_gap');
  
  if (entries.length === 0) {
    console.log('无有效数据条目');
    process.exit(0);
  }
  
  // ====== 读取历史对比 ======
  const recentLogs = loadRecentDailyLogs(7);
  const yesterday = recentLogs.find(r => r.date === recentLogs[recentLogs.length - 1]?.date) || null;
  
  // ====== 计算核心统计 ======
  const lastEntry = entries[entries.length - 1];
  const firstEntry = entries[0];
  const finalSpend = lastEntry.totalSpend || 0;
  const finalConversions = lastEntry.totalConversions || 0;
  const finalCPA = finalConversions > 0 ? finalSpend / finalConversions : 0;
  const budgetPct = finalSpend / CONFIG.dailyBudget * 100;
  const totalAlerts = entries.reduce((s, e) => s + (e.alertCount || 0), 0);
  
  // 新增 KPI
  const finalBalance = lastEntry.accountBalance || 0;
  const finalCTR = lastEntry.avgCTR || 0;
  const finalCVR = lastEntry.avgCVR || 0;
  const finalCPM = lastEntry.avgCPM || 0;
  const finalLeads = lastEntry.totalLeads || 0;
  const finalOpen = lastEntry.totalPrivateMsgOpen || 0;
  const finalRetain = lastEntry.totalPrivateMsgRetain || 0;
  const finalForm = lastEntry.totalFormSubmit || 0;
  const finalLiveViews = lastEntry.totalLiveViews || 0;
  const finalLiveOver1Min = lastEntry.totalLiveOver1Min || 0;
  const viewRetention = lastEntry.viewRetention || 0;
  const pacingHealth = lastEntry.pacingHealth || 'N/A';
  const projectedDaily = lastEntry.projectedDaily || 0;
  const idealSpend = lastEntry.idealSpend || 0;
  const pacingRatio = lastEntry.pacingRatio || 0;
  const openRetainRate = lastEntry.openRetainRate || 0;
  
  // 今日增量（从首个有效采样到最终）
  const spendDelta = finalSpend - (firstEntry.totalSpend || 0);
  const convDelta = finalConversions - (firstEntry.totalConversions || 0);
  const leadsDelta = finalLeads - (firstEntry.totalLeads || 0);
  
  // 最高消耗速度及峰值时间
  let maxSpeed = 0, maxSpeedTime = null, maxSpeedIdx = -1;
  entries.forEach((e, i) => {
    const s = e.speedCurrent || 0;
    if (s > maxSpeed) { maxSpeed = s; maxSpeedIdx = i; maxSpeedTime = e.time; }
  });
  const maxSpeedLabel = maxSpeedTime ? new Date(maxSpeedTime).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'}) : '-';
  
  // 消耗峰值时间
  let maxSpend = 0, maxSpendTime = null;
  entries.forEach(e => {
    if (e.totalSpend > maxSpend) { maxSpend = e.totalSpend; maxSpendTime = e.time; }
  });
  const maxSpendLabel = maxSpendTime ? new Date(maxSpendTime).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'}) : '-';
  
  // CPA 突增点（比前一点上涨超过30%）
  const cpaSpikes = [];
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i-1].avgCPA || 0;
    const cur = entries[i].avgCPA || 0;
    if (prev > 0 && cur > prev * 1.3) {
      cpaSpikes.push({ time: entries[i].time, prev, cur, rise: (cur/prev - 1) * 100 });
    }
  }
  
  // 告警类型分布与详情
  const alertTypeCounts = {};
  const alertDetails = [];
  entries.forEach(e => {
    (e.alertTypes || []).forEach(type => {
      alertTypeCounts[type] = (alertTypeCounts[type] || 0) + 1;
    });
    // 告警详情（记录每个采样点的告警类型和数量）
    if (e.alertCount > 0 && e.alertTypes && e.alertTypes.length > 0) {
      alertDetails.push({ time: e.time, slot: e.timeSlot, types: [...e.alertTypes], count: e.alertCount, severity: e.alertCount > 3 ? '高' : e.alertCount > 1 ? '中' : '低' });
    }
  });
  const alertTypeEntries = Object.entries(alertTypeCounts).sort((a, b) => b[1] - a[1]);
  const topAlerts = alertDetails.sort((a, b) => b.count - a.count).slice(0, 10);
  
  // 分时段统计（按增量与均值）
  const SLOT_ORDER = ['冷启动期','早高峰','午高峰','午后平稳期','晚高峰','夜间收尾','已结束'];
  const slotStats = {};
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const slot = e.timeSlot || '未知';
    if (!slotStats[slot]) slotStats[slot] = { count: 0, firstSpend: null, lastSpend: 0, firstConv: null, lastConv: 0, firstLeads: null, lastLeads: 0, totalCPA: 0, cpaCount: 0, alerts: 0, startTime: e.time, endTime: e.time };
    const st = slotStats[slot];
    st.count++;
    if (st.firstSpend === null) st.firstSpend = e.totalSpend || 0;
    st.lastSpend = e.totalSpend || 0;
    if (st.firstConv === null) st.firstConv = e.totalConversions || 0;
    st.lastConv = e.totalConversions || 0;
    if (st.firstLeads === null) st.firstLeads = e.totalLeads || 0;
    st.lastLeads = e.totalLeads || 0;
    if (e.avgCPA > 0) { st.totalCPA += e.avgCPA; st.cpaCount++; }
    st.alerts += e.alertCount || 0;
    if (new Date(e.time) > new Date(st.endTime)) st.endTime = e.time;
  }
  const slotNames = SLOT_ORDER.filter(s => slotStats[s]);
  const slotRows = slotNames.map(s => {
    const st = slotStats[s];
    return {
      slot: s,
      count: st.count,
      spendDelta: (st.lastSpend || 0) - (st.firstSpend || 0),
      convDelta: (st.lastConv || 0) - (st.firstConv || 0),
      leadsDelta: (st.lastLeads || 0) - (st.firstLeads || 0),
      avgCPA: st.cpaCount > 0 ? st.totalCPA / st.cpaCount : 0,
      alerts: st.alerts,
      endTime: st.endTime
    };
  });
  
  // 贡献最大时段
  const topSlot = slotRows.reduce((max, r) => r.spendDelta > max.spendDelta ? r : max, slotRows[0] || { spendDelta: 0 });
  
  // 图表数据
  const spendLabels = entries.map(e => {
    const t = new Date(e.time);
    return `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
  });
  const spendData = entries.map(e => e.totalSpend || 0);
  const cpaData = entries.map(e => e.avgCPA || 0);
  const convData = entries.map(e => e.totalConversions || 0);
  const speedData = entries.map(e => e.speedCurrent || 0);
  const rampData = entries.map(e => e.rampingUp || 0);
  const dropData = entries.map(e => e.dropping || 0);
  const budgetData = entries.map(e => (e.budgetUsed || 0) * 100);
  const ctrData = entries.map(e => e.avgCTR ? e.avgCTR * 100 : 0);
  const cvrData = entries.map(e => e.avgCVR ? e.avgCVR * 100 : 0);
  const cpmData = entries.map(e => e.avgCPM || 0);
  const liveViewData = entries.map(e => e.totalLiveViews || 0);
  const liveOver1MinData = entries.map(e => e.totalLiveOver1Min || 0);
  const idealSpendData = entries.map(e => e.idealSpend || 0);
  const projectedData = entries.map(e => e.projectedDaily || 0);
  
  // 洞察生成
  const insights = [];
  if (budgetPct >= 100) insights.push({ type: 'danger', text: `预算已耗尽：今日消耗 ¥${finalSpend.toLocaleString()}，达到日预算 ${budgetPct.toFixed(0)}%。` });
  else if (budgetPct >= 90) insights.push({ type: 'warning', text: `预算接近上限：已消耗 ${budgetPct.toFixed(0)}%，建议关注余额。` });
  else if (budgetPct < 50) insights.push({ type: 'info', text: `预算消耗偏慢：仅消耗 ${budgetPct.toFixed(0)}%，低于时间进度预期。` });
  else insights.push({ type: 'good', text: `预算消耗正常：已消耗 ${budgetPct.toFixed(0)}%。` });
  
  if (finalBalance > 0 && finalBalance < CONFIG.dailyBudget * 1.5) {
    insights.push({ type: 'danger', text: `账户余额偏低：¥${finalBalance.toLocaleString()}，不足日预算 1.5 倍，建议充值。` });
  }
  
  if (yesterday) {
    const spendVs = yesterday.finalSpend > 0 ? ((finalSpend - yesterday.finalSpend) / yesterday.finalSpend * 100) : null;
    const cpaVs = yesterday.finalCPA > 0 ? ((finalCPA - yesterday.finalCPA) / yesterday.finalCPA * 100) : null;
    const convVs = yesterday.finalConversions > 0 ? ((finalConversions - yesterday.finalConversions) / yesterday.finalConversions * 100) : null;
    const vsText = [];
    if (spendVs !== null) vsText.push(`消耗${spendVs >= 0 ? '增长' : '下降'} ${Math.abs(spendVs).toFixed(0)}%`);
    if (cpaVs !== null) vsText.push(`CPA${cpaVs >= 0 ? '上涨' : '下降'} ${Math.abs(cpaVs).toFixed(0)}%`);
    if (convVs !== null) vsText.push(`转化${convVs >= 0 ? '增长' : '下降'} ${Math.abs(convVs).toFixed(0)}%`);
    insights.push({ type: 'info', text: `较昨日（${yesterday.date}）：${vsText.join('，')}。` });
  }
  
  if (topSlot) {
    insights.push({ type: 'info', text: `贡献最大时段：${topSlot.slot}，增量消耗 ¥${topSlot.spendDelta.toLocaleString()}，占今日增量 ${spendDelta > 0 ? (topSlot.spendDelta / spendDelta * 100).toFixed(0) : 0}%。` });
  }
  
  if (cpaSpikes.length > 0) {
    insights.push({ type: 'warning', text: `CPA 突增 ${cpaSpikes.length} 次，最近一次在 ${new Date(cpaSpikes[cpaSpikes.length-1].time).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'})}，需关注成本波动。` });
  }
  
  if (totalAlerts > 0) {
    const topType = alertTypeEntries[0];
    insights.push({ type: 'warning', text: `今日告警 ${totalAlerts} 次，主要类型：${topType ? topType[0] : '未知'}（${topType ? topType[1] : 0} 次）。` });
  }
  
  // 近7天均值
  const avg7 = recentLogs.length > 0 ? {
    spend: recentLogs.reduce((s, r) => s + r.finalSpend, 0) / recentLogs.length,
    cpa: recentLogs.reduce((s, r) => s + r.finalCPA, 0) / recentLogs.length,
    conversions: recentLogs.reduce((s, r) => s + r.finalConversions, 0) / recentLogs.length,
    leads: recentLogs.reduce((s, r) => s + r.totalLeads, 0) / recentLogs.length,
  } : null;
  
  // ====== HTML 生成 ======
  const html = generateHTML({
    today, entries, gaps, spendLabels, spendData, cpaData, convData, speedData, rampData, dropData,
    budgetData, ctrData, cvrData, cpmData, liveViewData, liveOver1MinData, idealSpendData, projectedData,
    slotNames, slotRows, alertTypeEntries, topAlerts, cpaSpikes, insights, recentLogs, avg7, yesterday,
    finalSpend, finalConversions, finalCPA, budgetPct, totalAlerts, finalBalance, finalCTR, finalCVR, finalCPM,
    finalLeads, finalOpen, finalRetain, finalForm, finalLiveViews, finalLiveOver1Min, viewRetention, pacingHealth,
    projectedDaily, idealSpend, pacingRatio, openRetainRate, maxSpeed, maxSpeedLabel, maxSpendLabel, spendDelta, convDelta, leadsDelta
  });
  
  const reportFile = path.join(CONFIG.reportDir, `oceanengine-daily-${today}.html`);
  fs.writeFileSync(reportFile, html);
  console.log(`[${new Date().toLocaleTimeString()}] 日报已生成: ${reportFile}`);
  console.log(`  消耗 ¥${finalSpend.toFixed(0)} | 转化 ${finalConversions} | CPA ¥${finalCPA.toFixed(0)} | 告警 ${totalAlerts} | ${entries.length}个采样点`);
  
  const latestLink = path.join(CONFIG.reportDir, 'oceanengine-daily-latest.html');
  fs.writeFileSync(latestLink, html);
  console.log(`  最新日报: ${latestLink}`);
}

function generateHTML(d) {
  const insightsHtml = d.insights.map(i => `<div class="insight-item ${i.type}">${escHtml(i.text)}</div>`).join('');
  const yoySpend = d.yesterday && d.yesterday.finalSpend > 0 ? ((d.finalSpend - d.yesterday.finalSpend) / d.yesterday.finalSpend * 100) : null;
  const yoyCPA = d.yesterday && d.yesterday.finalCPA > 0 ? ((d.finalCPA - d.yesterday.finalCPA) / d.yesterday.finalCPA * 100) : null;
  const yoyConv = d.yesterday && d.yesterday.finalConversions > 0 ? ((d.finalConversions - d.yesterday.finalConversions) / d.yesterday.finalConversions * 100) : null;
  const yoyLeads = d.yesterday && d.yesterday.totalLeads > 0 ? ((d.finalLeads - d.yesterday.totalLeads) / d.yesterday.totalLeads * 100) : null;
  
  const vs7Spend = d.avg7 && d.avg7.spend > 0 ? ((d.finalSpend - d.avg7.spend) / d.avg7.spend * 100) : null;
  const vs7CPA = d.avg7 && d.avg7.cpa > 0 ? ((d.finalCPA - d.avg7.cpa) / d.avg7.cpa * 100) : null;
  const vs7Conv = d.avg7 && d.avg7.conversions > 0 ? ((d.finalConversions - d.avg7.conversions) / d.avg7.conversions * 100) : null;
  
  const healthClass = d.pacingHealth === 'good' ? 'green' : d.pacingHealth === 'warning' ? 'orange' : d.pacingHealth === 'danger' ? 'red' : 'blue';
  const budgetColor = d.budgetPct >= 90 ? 'red' : d.budgetPct >= 75 ? 'orange' : 'green';
  const balanceColor = d.finalBalance > 0 && d.finalBalance < CONFIG.dailyBudget * 1.5 ? 'red' : 'green';
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${CONFIG.accountName} 投放日报 ${d.today}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f7fa;color:#2c3e50;padding:20px;max-width:1300px;margin:0 auto}
.header{background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);color:#fff;padding:32px 40px;border-radius:14px;margin-bottom:24px}
.header h1{font-size:28px;margin-bottom:6px;letter-spacing:1px}
.header .sub{color:#a0aec0;font-size:14px;margin-top:8px}
.insight-box{background:#fff;border-radius:10px;padding:22px 24px;margin-bottom:24px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
.insight-box h2{font-size:16px;margin-bottom:14px;color:#334155}
.insight-item{padding:10px 14px;border-radius:6px;margin-bottom:8px;font-size:14px;line-height:1.5}
.insight-item.good{background:#ecfdf5;color:#065f46;border-left:4px solid #27ae60}
.insight-item.warning{background:#fffbeb;color:#92400e;border-left:4px solid #e67e22}
.insight-item.danger{background:#fef2f2;color:#991b1b;border-left:4px solid #e74c3c}
.insight-item.info{background:#eff6ff;color:#1e40af;border-left:4px solid #2980b9}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px}
.card{background:#fff;border-radius:10px;padding:18px 16px;box-shadow:0 2px 12px rgba(0,0,0,.06);transition:transform .15s}
.card:hover{transform:translateY(-2px)}
.card .label{font-size:11px;color:#95a5a6;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.card .value{font-size:24px;font-weight:700}
.card .subv{font-size:12px;color:#95a5a6;margin-top:4px}
.green{color:#27ae60}.red{color:#e74c3c}.blue{color:#2980b9}.orange{color:#e67e22}
.section{background:#fff;border-radius:10px;padding:24px 28px;margin-bottom:20px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
.section h2{font-size:18px;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #ecf0f1}
.chart-row{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}
@media(max-width:768px){.chart-row{grid-template-columns:1fr}}
.chart-container{position:relative;height:300px}
.chart-container canvas{width:100%!important;height:100%!important}
.footer{text-align:center;color:#94a3b8;font-size:12px;margin-top:32px;padding:20px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#f8fafc;padding:10px 8px;text-align:left;font-weight:600;border-bottom:2px solid #e2e8f0;white-space:nowrap;color:#64748b}
td{padding:8px;border-bottom:1px solid #f1f5f9}
tr:hover{background:#f8faff}
.gap-marker{background:#fff3cd;padding:2px 6px;border-radius:4px;font-size:11px}
.funnel{display:flex;align-items:center;gap:8px;margin:16px 0;flex-wrap:wrap}
.funnel-step{background:#f1f5f9;border-radius:8px;padding:12px 16px;text-align:center;min-width:80px}
.funnel-step .num{font-size:20px;font-weight:700;color:#334155}
.funnel-step .label{font-size:12px;color:#64748b;margin-top:4px}
.funnel-arrow{color:#94a3b8;font-size:20px}
.compare-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:16px}
@media(max-width:768px){.compare-grid{grid-template-columns:1fr 1fr}}
.compare-card{background:#f8fafc;border-radius:8px;padding:14px;text-align:center}
.compare-card .title{font-size:12px;color:#64748b;margin-bottom:6px}
.compare-card .value{font-size:20px;font-weight:700;color:#334155}
.compare-card .change{font-size:12px;margin-top:4px}
</style>
</head>
<body>

<div class="header">
  <h1>📊 ${CONFIG.accountName} · 投放日报</h1>
  <div class="sub">
    日期: ${d.today} | 数据周期: ${d.spendLabels[0]} – ${d.spendLabels[d.spendLabels.length-1]} 
    | ${d.entries.length} 个采样点 ${d.gaps.length > 0 ? '· <span style="color:#e67e22">'+d.gaps.length+'个数据断层</span>' : ''}
    | 日预算 ¥${CONFIG.dailyBudget.toLocaleString()} | 16h直播(7-23)
    ${d.maxSpendLabel ? '| 消耗峰值 ' + d.maxSpendLabel : ''}
  </div>
</div>

<div class="insight-box">
  <h2>🔍 今日洞察</h2>
  ${insightsHtml}
</div>

<div class="cards">
  <div class="card">
    <div class="label">最终消耗</div>
    <div class="value ${budgetColor}">¥${d.finalSpend.toLocaleString()}</div>
    <div class="subv">日预算 ${d.budgetPct.toFixed(0)}%${d.budgetPct >= 90 ? ' ⚠接近上限' : ''}</div>
  </div>
  <div class="card">
    <div class="label">总转化 / 平均CPA</div>
    <div class="value blue">${d.finalConversions}</div>
    <div class="subv">CPA ¥${d.finalCPA.toFixed(0)}</div>
  </div>
  <div class="card">
    <div class="label">今日告警</div>
    <div class="value ${d.totalAlerts > 10 ? 'red' : 'orange'}">${d.totalAlerts}</div>
    <div class="subv">${d.entries.length}次采样</div>
  </div>
  <div class="card">
    <div class="label">数据完整性</div>
    <div class="value green">${d.entries.length}/${d.entries.length + d.gaps.length}</div>
    <div class="subv">${d.gaps.length > 0 ? '断层 '+d.gaps.length+'次' : '完整记录'}</div>
  </div>
  <div class="card">
    <div class="label">最高消耗速度</div>
    <div class="value orange">¥${d.maxSpeed.toFixed(0)}/min</div>
    <div class="subv">${d.maxSpeedLabel}</div>
  </div>
  <div class="card">
    <div class="label">开口留资率</div>
    <div class="value blue">${d.openRetainRate ? (d.openRetainRate*100).toFixed(1)+'%' : 'N/A'}</div>
    <div class="subv">线索来源</div>
  </div>
  <div class="card">
    <div class="label">账户余额</div>
    <div class="value ${balanceColor}">¥${d.finalBalance.toLocaleString()}</div>
    <div class="subv">${d.finalBalance < CONFIG.dailyBudget * 1.5 ? '低于日预算1.5倍' : '充足'}</div>
  </div>
  <div class="card">
    <div class="label">CTR / CVR / CPM</div>
    <div class="value blue">${d.finalCTR ? (d.finalCTR*100).toFixed(1)+'%' : '—'}</div>
    <div class="subv">CVR ${d.finalCVR ? (d.finalCVR*100).toFixed(1)+'%' : '—'} · CPM ¥${d.finalCPM.toFixed(0)}</div>
  </div>
  <div class="card">
    <div class="label">节奏健康度</div>
    <div class="value ${healthClass}">${d.pacingHealth}</div>
    <div class="subv">预测日末 ¥${d.projectedDaily.toLocaleString()}</div>
  </div>
  <div class="card">
    <div class="label">直播间效果</div>
    <div class="value blue">${d.finalLiveViews.toLocaleString()}</div>
    <div class="subv">观看 · ${d.finalLiveOver1Min.toLocaleString()} >1min · ${d.viewRetention ? (d.viewRetention*100).toFixed(1)+'%' : '—'} 停留</div>
  </div>
</div>

<div class="section">
  <h2>🎯 转化线索漏斗</h2>
  <div class="funnel">
    <div class="funnel-step"><div class="num">${d.finalLeads.toLocaleString()}</div><div class="label">线索</div></div>
    <div class="funnel-arrow">→</div>
    <div class="funnel-step"><div class="num">${d.finalOpen.toLocaleString()}</div><div class="label">私信开口</div></div>
    <div class="funnel-arrow">→</div>
    <div class="funnel-step"><div class="num">${d.finalRetain.toLocaleString()}</div><div class="label">私信留资</div></div>
    <div class="funnel-arrow">→</div>
    <div class="funnel-step"><div class="num">${d.finalForm.toLocaleString()}</div><div class="label">表单提交</div></div>
  </div>
</div>

<div class="section">
  <h2>📅 跨日对比</h2>
  <div class="compare-grid">
    <div class="compare-card">
      <div class="title">消耗</div>
      <div class="value">¥${d.finalSpend.toLocaleString()}</div>
      <div class="change ${yoySpend > 0 ? 'red' : 'green'}">${yoySpend !== null ? '较昨日 ' + (yoySpend >= 0 ? '+' : '') + yoySpend.toFixed(0) + '%' : '无昨日数据'}</div>
      <div class="change ${vs7Spend > 0 ? 'red' : 'green'}">${vs7Spend !== null ? '较7日均 ' + (vs7Spend >= 0 ? '+' : '') + vs7Spend.toFixed(0) + '%' : '无7天数据'}</div>
    </div>
    <div class="compare-card">
      <div class="title">CPA</div>
      <div class="value">¥${d.finalCPA.toFixed(0)}</div>
      <div class="change ${yoyCPA > 0 ? 'red' : 'green'}">${yoyCPA !== null ? '较昨日 ' + (yoyCPA >= 0 ? '+' : '') + yoyCPA.toFixed(0) + '%' : '无昨日数据'}</div>
      <div class="change ${vs7CPA > 0 ? 'red' : 'green'}">${vs7CPA !== null ? '较7日均 ' + (vs7CPA >= 0 ? '+' : '') + vs7CPA.toFixed(0) + '%' : '无7天数据'}</div>
    </div>
    <div class="compare-card">
      <div class="title">转化</div>
      <div class="value">${d.finalConversions.toLocaleString()}</div>
      <div class="change ${yoyConv > 0 ? 'red' : 'green'}">${yoyConv !== null ? '较昨日 ' + (yoyConv >= 0 ? '+' : '') + yoyConv.toFixed(0) + '%' : '无昨日数据'}</div>
      <div class="change ${vs7Conv > 0 ? 'red' : 'green'}">${vs7Conv !== null ? '较7日均 ' + (vs7Conv >= 0 ? '+' : '') + vs7Conv.toFixed(0) + '%' : '无7天数据'}</div>
    </div>
    <div class="compare-card">
      <div class="title">线索</div>
      <div class="value">${d.finalLeads.toLocaleString()}</div>
      <div class="change ${yoyLeads > 0 ? 'red' : 'green'}">${yoyLeads !== null ? '较昨日 ' + (yoyLeads >= 0 ? '+' : '') + yoyLeads.toFixed(0) + '%' : '无昨日数据'}</div>
      <div class="change">${d.avg7 ? '7日均 ' + d.avg7.leads.toFixed(0) : '无7天数据'}</div>
    </div>
  </div>
  ${d.recentLogs.length > 0 ? `
  <div class="chart-row" style="margin-top:20px">
    <div class="chart-container"><canvas id="yoyChart"></canvas></div>
  </div>` : ''}
</div>

<div class="chart-row">
  <div class="section"><h2>💰 消耗走势 (全天)</h2><div class="chart-container"><canvas id="spendChart"></canvas></div></div>
  <div class="section"><h2>🎯 CPA 趋势</h2><div class="chart-container"><canvas id="cpaChart"></canvas></div></div>
</div>
<div class="chart-row">
  <div class="section"><h2>📊 预算消耗进度 (%)</h2><div class="chart-container"><canvas id="budgetChart"></canvas></div></div>
  <div class="section"><h2>📈 转化数 & 消耗速度</h2><div class="chart-container"><canvas id="convChart"></canvas></div></div>
</div>
<div class="chart-row">
  <div class="section"><h2>🔥 起量 / 📉 掉量计划数</h2><div class="chart-container"><canvas id="trendChart"></canvas></div></div>
  <div class="section"><h2>🎯 CTR / CVR / CPM 趋势</h2><div class="chart-container"><canvas id="effChart"></canvas></div></div>
</div>
<div class="chart-row">
  <div class="section"><h2>📺 直播间观看 & 停留</h2><div class="chart-container"><canvas id="liveChart"></canvas></div></div>
  <div class="section"><h2>📐 节奏健康度：实际 vs 理想 vs 预测</h2><div class="chart-container"><canvas id="pacingChart"></canvas></div></div>
</div>
<div class="chart-row">
  <div class="section"><h2>⏰ 分时段增量消耗</h2><div class="chart-container"><canvas id="slotDeltaChart"></canvas></div></div>
  <div class="section"><h2>🔔 告警类型分布</h2><div class="chart-container"><canvas id="alertTypeChart"></canvas></div></div>
</div>

${d.gaps.length > 0 ? `
<div class="section"><h2>⚠ 数据断层记录</h2>
<table><thead><tr><th>时间</th><th>原因</th></tr></thead>
<tbody>${d.gaps.map(g => `<tr><td>${new Date(g.time).toLocaleTimeString('zh-CN')}</td><td>${escHtml(g.reason || '未知')}</td></tr>`).join('')}</tbody></table></div>` : ''}

<div class="section">
  <h2>⏰ 分时段增量汇总</h2>
  <table>
    <thead><tr><th>时段</th><th>采样次数</th><th>增量消耗</th><th>增量转化</th><th>增量线索</th><th>平均CPA</th><th>告警数</th></tr></thead>
    <tbody>${d.slotRows.map(r => `<tr><td>${r.slot}</td><td>${r.count}</td><td>¥${r.spendDelta.toLocaleString()}</td><td>${r.convDelta}</td><td>${r.leadsDelta}</td><td>¥${r.avgCPA.toFixed(0)}</td><td>${r.alerts}</td></tr>`).join('')}</tbody>
  </table>
</div>

<div class="section">
  <h2>🔔 告警类型分布</h2>
  <table>
    <thead><tr><th>告警类型</th><th>次数</th><th>占比</th></tr></thead>
    <tbody>${d.alertTypeEntries.map(([type, count]) => `<tr><td>${escHtml(type)}</td><td>${count}</td><td>${d.totalAlerts > 0 ? (count / d.totalAlerts * 100).toFixed(1) : 0}%</td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:#94a3b8">今日无告警</td></tr>'}</tbody>
  </table>
</div>

${d.topAlerts.length > 0 ? `
<div class="section">
  <h2>🔔 告警密集时刻 TOP10</h2>
  <table>
    <thead><tr><th>时间</th><th>时段</th><th>告警类型</th><th>数量</th><th>级别</th></tr></thead>
    <tbody>${d.topAlerts.map(a => `<tr><td>${new Date(a.time).toLocaleTimeString('zh-CN')}</td><td>${a.slot}</td><td>${escHtml(a.types.join(', '))}</td><td>${a.count}</td><td>${a.severity}</td></tr>`).join('')}</tbody>
  </table>
</div>` : ''}

${d.cpaSpikes.length > 0 ? `
<div class="section">
  <h2>📈 CPA 突增时刻</h2>
  <table>
    <thead><tr><th>时间</th><th>前一点 CPA</th><th>当前 CPA</th><th>涨幅</th></tr></thead>
    <tbody>${d.cpaSpikes.map(s => `<tr><td>${new Date(s.time).toLocaleTimeString('zh-CN')}</td><td>¥${s.prev.toFixed(0)}</td><td>¥${s.cur.toFixed(0)}</td><td style="color:#e74c3c">+${s.rise.toFixed(0)}%</td></tr>`).join('')}</tbody>
  </table>
</div>` : ''}

<div class="footer">
  WorkBuddy 自动生成 · ${d.today} · ${CONFIG.accountName} · 16h直播(7:00-23:00) · 日报在每天23:05自动生成
  <br>数据来源: monitor-data/daily-${d.today}.json · ${d.entries.length}个有效采样点
  <br>Chart.js 依赖 CDN (jsdelivr.net)，离线环境图表无法加载
</div>

<script>
Chart.defaults.color = '#64748b';
Chart.defaults.borderColor = '#e2e8f0';
const labels = ${escJsonForScript(d.spendLabels)};

new Chart(document.getElementById('spendChart'),{
  type:'line',
  data:{labels,datasets:[{label:'累计消耗 (¥)',data:${JSON.stringify(d.spendData)},borderColor:'#e74c3c',backgroundColor:'rgba(231,76,60,0.1)',fill:true,tension:0.3,pointRadius:2}]},
  options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:v=>'¥'+v.toLocaleString()}}},plugins:{tooltip:{callbacks:{label:ctx=>'¥'+ctx.raw.toLocaleString()}}}}
});

new Chart(document.getElementById('cpaChart'),{
  type:'line',
  data:{labels,datasets:[{label:'平均CPA (¥)',data:${JSON.stringify(d.cpaData)},borderColor:'#e67e22',backgroundColor:'rgba(230,126,34,0.1)',fill:true,tension:0.3,pointRadius:2}]},
  options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:v=>'¥'+v.toFixed(0)}}},plugins:{tooltip:{callbacks:{label:ctx=>'¥'+ctx.raw.toFixed(2)}}}}
});

new Chart(document.getElementById('budgetChart'),{
  type:'line',
  data:{labels,datasets:[{label:'预算消耗 (%)',data:${JSON.stringify(d.budgetData)},borderColor:'#8b5cf6',backgroundColor:'rgba(139,92,246,0.1)',fill:true,tension:0.3,pointRadius:2},{label:'100%线',data:Array(labels.length).fill(100),borderColor:'#e74c3c',borderDash:[5,5],borderWidth:1,pointRadius:0,fill:false}]},
  options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:110,ticks:{callback:v=>v+'%'}}},plugins:{tooltip:{callbacks:{label:ctx=>ctx.raw.toFixed(1)+'%'}}}}
});

new Chart(document.getElementById('convChart'),{
  type:'line',
  data:{labels,datasets:[{label:'转化数',data:${JSON.stringify(d.convData)},borderColor:'#27ae60',backgroundColor:'rgba(39,174,96,0.1)',fill:false,tension:0.3,pointRadius:2,yAxisID:'y'},{label:'消耗速度 (¥/min)',data:${JSON.stringify(d.speedData)},borderColor:'#2980b9',backgroundColor:'rgba(41,128,185,0.1)',fill:false,tension:0.3,pointRadius:2,yAxisID:'y1'}]},
  options:{responsive:true,maintainAspectRatio:false,scales:{y:{position:'left',title:{display:true,text:'转化数'}},y1:{position:'right',title:{display:true,text:'¥/min'},grid:{drawOnChartArea:false}}}}
});

new Chart(document.getElementById('trendChart'),{
  type:'line',
  data:{labels,datasets:[{label:'起量计划',data:${JSON.stringify(d.rampData)},borderColor:'#27ae60',backgroundColor:'rgba(39,174,96,0.2)',fill:true,tension:0.3,pointRadius:2},{label:'掉量计划',data:${JSON.stringify(d.dropData)},borderColor:'#e74c3c',backgroundColor:'rgba(231,76,60,0.2)',fill:true,tension:0.3,pointRadius:2}]},
  options:{responsive:true,maintainAspectRatio:false}
});

new Chart(document.getElementById('effChart'),{
  type:'line',
  data:{labels,datasets:[{label:'CTR (%)',data:${JSON.stringify(d.ctrData)},borderColor:'#10b981',yAxisID:'y'},{label:'CVR (%)',data:${JSON.stringify(d.cvrData)},borderColor:'#f59e0b',yAxisID:'y'},{label:'CPM (¥)',data:${JSON.stringify(d.cpmData)},borderColor:'#8b5cf6',yAxisID:'y1'}]},
  options:{responsive:true,maintainAspectRatio:false,scales:{y:{position:'left',title:{display:true,text:'CTR/CVR %'}},y1:{position:'right',title:{display:true,text:'CPM ¥'},grid:{drawOnChartArea:false}}}}
});

new Chart(document.getElementById('liveChart'),{
  type:'line',
  data:{labels,datasets:[{label:'观看数',data:${JSON.stringify(d.liveViewData)},borderColor:'#06b6d4',backgroundColor:'rgba(6,182,212,0.1)',fill:true,tension:0.3,pointRadius:2,yAxisID:'y'},{label:'>1min 停留',data:${JSON.stringify(d.liveOver1MinData)},borderColor:'#ec4899',backgroundColor:'rgba(236,72,153,0.1)',fill:true,tension:0.3,pointRadius:2,yAxisID:'y1'}]},
  options:{responsive:true,maintainAspectRatio:false,scales:{y:{position:'left',title:{display:true,text:'观看数'}},y1:{position:'right',title:{display:true,text:'>1min 停留'},grid:{drawOnChartArea:false}}}}
});

new Chart(document.getElementById('pacingChart'),{
  type:'line',
  data:{labels,datasets:[{label:'实际累计消耗',data:${JSON.stringify(d.spendData)},borderColor:'#e74c3c',backgroundColor:'rgba(231,76,60,0.05)',fill:true,tension:0.3,pointRadius:2},{label:'理想消耗线',data:${JSON.stringify(d.idealSpendData)},borderColor:'#27ae60',borderDash:[5,5],pointRadius:0,fill:false},{label:'预测日末消耗',data:${JSON.stringify(d.projectedData)},borderColor:'#f59e0b',borderDash:[10,5],pointRadius:0,fill:false}]},
  options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:v=>'¥'+v.toLocaleString()}}},plugins:{tooltip:{callbacks:{label:ctx=>'¥'+ctx.raw.toLocaleString()}}}}
});

new Chart(document.getElementById('slotDeltaChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(d.slotNames)},datasets:[{label:'增量消耗 (¥)',data:${JSON.stringify(d.slotRows.map(r => r.spendDelta))},backgroundColor:${JSON.stringify(d.slotRows.map(r => r.spendDelta > (d.spendDelta / d.slotRows.length * 1.3) ? 'rgba(231,76,60,0.7)' : 'rgba(41,128,185,0.7)'))},borderColor:${JSON.stringify(d.slotRows.map(r => r.spendDelta > (d.spendDelta / d.slotRows.length * 1.3) ? '#e74c3c' : '#2980b9'))},borderWidth:1}]},
  options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:v=>'¥'+v.toLocaleString()}}},plugins:{tooltip:{callbacks:{label:ctx=>'¥'+ctx.raw.toLocaleString()}}}}
});

new Chart(document.getElementById('alertTypeChart'),{
  type:'doughnut',
  data:{labels:${JSON.stringify(d.alertTypeEntries.map(([t]) => t))},datasets:[{data:${JSON.stringify(d.alertTypeEntries.map(([,c]) => c))},backgroundColor:${JSON.stringify(d.alertTypeEntries.map((_,i) => ['#e74c3c','#e67e22','#f59e0b','#27ae60','#2980b9','#8b5cf6','#ec4899','#06b6d4'][i % 8]))}}]},
  options:{responsive:true,maintainAspectRatio:false}
});

${d.recentLogs.length > 0 ? `
new Chart(document.getElementById('yoyChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(d.recentLogs.map(r => r.date).concat([d.today]))},datasets:[{label:'消耗 (¥)',data:${JSON.stringify(d.recentLogs.map(r => r.finalSpend).concat([d.finalSpend]))},backgroundColor:${JSON.stringify(d.recentLogs.map(() => 'rgba(41,128,185,0.7)').concat(['rgba(231,76,60,0.8)']))},borderColor:${JSON.stringify(d.recentLogs.map(() => '#2980b9').concat(['#e74c3c']))},borderWidth:1}]},
  options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:v=>'¥'+v.toLocaleString()}}},plugins:{tooltip:{callbacks:{label:ctx=>'¥'+ctx.raw.toLocaleString()}}}}
});` : ''}
</script>
</body>
</html>`;
}

main();
