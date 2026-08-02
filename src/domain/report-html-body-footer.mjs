// src/domain/report-html-body-footer.mjs - 报表页脚

export function buildReportHtmlFooter({ today, accountName, liveWin }) {
  return `<div class="footer">WorkBuddy 自动监控 · ${today} · 巨量引擎 ${accountName} · ${liveWin.label} · 按真实时间差环比 · 离线快照<br>建议反馈通过飞书卡片 是/否 按钮收集 · (离线快照，无外部链接) · <a href="oceanengine-daily-${today}.html" style="color:#10b981;font-weight:bold">📊 今日日报(23:05生成)</a></div>`;
}
