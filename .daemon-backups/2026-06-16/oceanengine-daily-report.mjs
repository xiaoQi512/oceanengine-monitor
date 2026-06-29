// oceanengine-daily-report.mjs — 巨量引擎每日投放日报生成器
// 每天23:05触发，读取 daily-YYYY-MM-DD.json 全量日志生成HTML日报
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLocalDate, DATA_DIR, ACCOUNT_NAME, DAILY_BUDGET } from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  accountName: ACCOUNT_NAME,
  dataDir: DATA_DIR,
  reportDir: __dirname,
  dailyBudget: DAILY_BUDGET,
};

function escHtml(str) { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

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
  
  // ====== 计算统计 ======
  const lastEntry = entries[entries.length - 1];
  const finalSpend = lastEntry.totalSpend || 0;
  const finalConversions = lastEntry.totalConversions || 0;
  const finalCPA = finalConversions > 0 ? finalSpend / finalConversions : 0;
  const budgetPct = (finalSpend / CONFIG.dailyBudget * 100).toFixed(0);
  const totalAlerts = entries.reduce((s, e) => s + (e.alertCount || 0), 0);
  
  // 分时段统计
  const slotStats = {};
  for (const e of entries) {
    const slot = e.timeSlot || '未知';
    if (!slotStats[slot]) slotStats[slot] = { count: 0, spend: 0, alerts: 0 };
    slotStats[slot].count++;
    slotStats[slot].spend = Math.max(slotStats[slot].spend, e.totalSpend || 0);
    slotStats[slot].alerts += e.alertCount || 0;
  }
  
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
  const slotNames = Object.keys(slotStats);
  const slotAlertData = slotNames.map(s => slotStats[s].alerts);
  const budgetData = entries.map(e => (e.budgetUsed || 0) * 100);
  
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${CONFIG.accountName} 投放日报 ${today}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f7fa;color:#2c3e50;padding:20px;max-width:1200px;margin:0 auto}
.header{background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);color:#fff;padding:32px 40px;border-radius:14px;margin-bottom:24px}
.header h1{font-size:28px;margin-bottom:6px;letter-spacing:1px}
.header .sub{color:#a0aec0;font-size:14px;margin-top:8px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:24px}
.card{background:#fff;border-radius:10px;padding:20px 18px;box-shadow:0 2px 12px rgba(0,0,0,.06);transition:transform .15s}
.card:hover{transform:translateY(-2px)}
.card .label{font-size:11px;color:#95a5a6;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.card .value{font-size:26px;font-weight:700}
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
</style>
</head>
<body>

<div class="header">
  <h1>📊 ${CONFIG.accountName} · 投放日报</h1>
  <div class="sub">
    日期: ${today} | 数据周期: ${spendLabels[0]} – ${spendLabels[spendLabels.length-1]} 
    | ${entries.length} 个采样点 ${gaps.length > 0 ? '· <span style="color:#e67e22">'+gaps.length+'个数据断层</span>' : ''}
    | 日预算 ¥${CONFIG.dailyBudget.toLocaleString()} | 16h直播(7-23)
  </div>
</div>

<div class="cards">
  <div class="card">
    <div class="label">最终消耗</div>
    <div class="value ${budgetPct >= 90 ? 'red' : budgetPct >= 75 ? 'orange' : 'green'}">¥${finalSpend.toLocaleString()}</div>
    <div class="subv">日预算 ${budgetPct}%${budgetPct >= 90 ? ' ⚠接近上限' : ''}</div>
  </div>
  <div class="card">
    <div class="label">总转化 / 平均CPA</div>
    <div class="value blue">${finalConversions}</div>
    <div class="subv">CPA ¥${finalCPA.toFixed(0)}</div>
  </div>
  <div class="card">
    <div class="label">今日告警</div>
    <div class="value ${totalAlerts > 10 ? 'red' : 'orange'}">${totalAlerts}</div>
    <div class="subv">${entries.length}次采样</div>
  </div>
  <div class="card">
    <div class="label">数据完整性</div>
    <div class="value green">${entries.length}/${entries.length + gaps.length}</div>
    <div class="subv">${gaps.length > 0 ? '断层 '+gaps.length+'次' : '完整记录'}</div>
  </div>
  <div class="card">
    <div class="label">最高消耗速度</div>
    <div class="value orange">¥${Math.max(...speedData, 0).toFixed(0)}/min</div>
    <div class="subv">峰值时段</div>
  </div>
  <div class="card">
    <div class="label">开口留资率 (终值)</div>
    <div class="value blue">${lastEntry.openRetainRate ? (lastEntry.openRetainRate*100).toFixed(1)+'%' : 'N/A'}</div>
    <div class="subv">线索来源</div>
  </div>
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
  <div class="section"><h2>🔔 分时段告警分布</h2><div class="chart-container"><canvas id="alertChart"></canvas></div></div>
</div>

${gaps.length > 0 ? `
<div class="section"><h2>⚠ 数据断层记录</h2>
<table><thead><tr><th>时间</th><th>原因</th></tr></thead>
<tbody>${gaps.map(g => `<tr><td>${new Date(g.time).toLocaleTimeString('zh-CN')}</td><td>${escHtml(g.reason || '未知')}</td></tr>`).join('')}</tbody></table></div>` : ''}

<div class="section"><h2>⏰ 分时段汇总</h2>
<table><thead><tr><th>时段</th><th>采样次数</th><th>该时段终点消耗</th><th>告警数</th></tr></thead>
<tbody>${slotNames.map(s => `<tr><td>${s}</td><td>${slotStats[s].count}</td><td>¥${slotStats[s].spend.toLocaleString()}</td><td>${slotStats[s].alerts}</td></tr>`).join('')}</tbody></table></div>

<div class="footer">
  WorkBuddy 自动生成 · ${today} · ${CONFIG.accountName} · 16h直播(7:00-23:00) · 日报在每天23:05自动生成
  <br>数据来源: monitor-data/daily-${today}.json · ${entries.length}个有效采样点
  <br>Chart.js 依赖 CDN (jsdelivr.net)，离线环境图表无法加载
</div>

<script>
Chart.defaults.color = '#64748b';
Chart.defaults.borderColor = '#e2e8f0';
const labels = ${JSON.stringify(spendLabels)};

new Chart(document.getElementById('spendChart'),{
  type:'line',
  data:{labels,datasets:[{label:'累计消耗 (¥)',data:${JSON.stringify(spendData)},borderColor:'#e74c3c',backgroundColor:'rgba(231,76,60,0.1)',fill:true,tension:0.3,pointRadius:2}]},
  options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:v=>'¥'+v.toLocaleString()}}},plugins:{tooltip:{callbacks:{label:ctx=>'¥'+ctx.raw.toLocaleString()}}}}
});

new Chart(document.getElementById('cpaChart'),{
  type:'line',
  data:{labels,datasets:[{label:'平均CPA (¥)',data:${JSON.stringify(cpaData)},borderColor:'#e67e22',backgroundColor:'rgba(230,126,34,0.1)',fill:true,tension:0.3,pointRadius:2}]},
  options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:v=>'¥'+v.toFixed(0)}}},plugins:{tooltip:{callbacks:{label:ctx=>'¥'+ctx.raw.toFixed(2)}}}}
});

new Chart(document.getElementById('budgetChart'),{
  type:'line',
  data:{labels,datasets:[{label:'预算消耗 (%)',data:${JSON.stringify(budgetData)},borderColor:'#8b5cf6',backgroundColor:'rgba(139,92,246,0.1)',fill:true,tension:0.3,pointRadius:2},{label:'100%线',data:Array(labels.length).fill(100),borderColor:'#e74c3c',borderDash:[5,5],borderWidth:1,pointRadius:0,fill:false}]},
  options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:110,ticks:{callback:v=>v+'%'}}},plugins:{tooltip:{callbacks:{label:ctx=>ctx.raw.toFixed(1)+'%'}}}}
});

new Chart(document.getElementById('convChart'),{
  type:'line',
  data:{labels,datasets:[{label:'转化数',data:${JSON.stringify(convData)},borderColor:'#27ae60',backgroundColor:'rgba(39,174,96,0.1)',fill:false,tension:0.3,pointRadius:2,yAxisID:'y'},{label:'消耗速度 (¥/min)',data:${JSON.stringify(speedData)},borderColor:'#2980b9',backgroundColor:'rgba(41,128,185,0.1)',fill:false,tension:0.3,pointRadius:2,yAxisID:'y1'}]},
  options:{responsive:true,maintainAspectRatio:false,scales:{y:{position:'left',title:{display:true,text:'转化数'}},y1:{position:'right',title:{display:true,text:'¥/min'},grid:{drawOnChartArea:false}}}}
});

new Chart(document.getElementById('trendChart'),{
  type:'line',
  data:{labels,datasets:[{label:'起量计划',data:${JSON.stringify(rampData)},borderColor:'#27ae60',backgroundColor:'rgba(39,174,96,0.2)',fill:true,tension:0.3,pointRadius:2},{label:'掉量计划',data:${JSON.stringify(dropData)},borderColor:'#e74c3c',backgroundColor:'rgba(231,76,60,0.2)',fill:true,tension:0.3,pointRadius:2}]},
  options:{responsive:true,maintainAspectRatio:false}
});

new Chart(document.getElementById('alertChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(slotNames)},datasets:[{label:'告警数',data:${JSON.stringify(slotAlertData)},backgroundColor:${JSON.stringify(slotAlertData.map(v=>v>5?'rgba(231,76,60,0.7)':v>2?'rgba(230,126,34,0.7)':'rgba(39,174,96,0.7)'))},borderColor:${JSON.stringify(slotAlertData.map(v=>v>5?'#e74c3c':v>2?'#e67e22':'#27ae60'))},borderWidth:1}]},
  options:{responsive:true,maintainAspectRatio:false}
});
</script>
</body>
</html>`;

  const reportFile = path.join(CONFIG.reportDir, `oceanengine-daily-${today}.html`);
  fs.writeFileSync(reportFile, html);
  console.log(`[${new Date().toLocaleTimeString()}] 日报已生成: ${reportFile}`);
  console.log(`  消耗 ¥${finalSpend.toFixed(0)} | 转化 ${finalConversions} | CPA ¥${finalCPA.toFixed(0)} | 告警 ${totalAlerts} | ${entries.length}个采样点`);
  
  const latestLink = path.join(CONFIG.reportDir, 'oceanengine-daily-latest.html');
  fs.writeFileSync(latestLink, html);
  console.log(`  最新日报: ${latestLink}`);
}

main();
