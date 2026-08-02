// src/domain/daily-report-html-script.mjs - 日报 HTML 图表脚本

export function buildDailyReportHtmlScript({ labels, spendData, cpaData, budgetData, convData, speedData }) {
  return `<script>
Chart.defaults.color = '#64748b';
Chart.defaults.borderColor = '#e2e8f0';
const labels = ${JSON.stringify(labels)};
new Chart(document.getElementById('spendChart'),{type:'line',data:{labels,datasets:[{label:'累计消耗(¥)',data:${JSON.stringify(spendData)},borderColor:'#e74c3c',backgroundColor:'rgba(231,76,60,0.1)',fill:true,tension:0.3,pointRadius:2}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:v=>'¥'+v.toLocaleString()}}},plugins:{tooltip:{callbacks:{label:ctx=>'¥'+ctx.raw.toLocaleString()}}}}});
new Chart(document.getElementById('cpaChart'),{type:'line',data:{labels,datasets:[{label:'平均CPA (¥)',data:${JSON.stringify(cpaData)},borderColor:'#e67e22',backgroundColor:'rgba(230,126,34,0.1)',fill:true,tension:0.3,pointRadius:2}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{callback:v=>'¥'+v.toFixed(0)}}},plugins:{tooltip:{callbacks:{label:ctx=>'¥'+ctx.raw.toFixed(2)}}}}});
new Chart(document.getElementById('budgetChart'),{type:'line',data:{labels,datasets:[{label:'预算消耗(%)',data:${JSON.stringify(budgetData)},borderColor:'#8b5cf6',backgroundColor:'rgba(139,92,246,0.1)',fill:true,tension:0.3,pointRadius:2},{label:'100%线',data:Array(labels.length).fill(100),borderColor:'#e74c3c',borderDash:[5,5],borderWidth:1,pointRadius:0,fill:false}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:110,ticks:{callback:v=>v+'%'}}},plugins:{tooltip:{callbacks:{label:ctx=>ctx.raw.toFixed(1)+'%'}}}}});
new Chart(document.getElementById('convChart'),{type:'line',data:{labels,datasets:[{label:'转化数',data:${JSON.stringify(convData)},borderColor:'#27ae60',backgroundColor:'rgba(39,174,96,0.1)',fill:false,tension:0.3,pointRadius:2,yAxisID:'y'},{label:'消耗速度 (¥/min)',data:${JSON.stringify(speedData)},borderColor:'#2980b9',backgroundColor:'rgba(41,128,185,0.1)',fill:false,tension:0.3,pointRadius:2,yAxisID:'y1'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{position:'left'},y1:{position:'right',grid:{drawOnChartArea:false}}}}});
</script>`;
}
