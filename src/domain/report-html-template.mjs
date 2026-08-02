// src/domain/report-html-template.mjs - 离线报表 HTML 模板组合
import { REPORT_HTML_STYLE } from './report-html-style.mjs';
import { buildReportHtmlBody } from './report-html-body.mjs';

export function buildReportHtmlTemplate(params) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>极狐-区域福利号-直播 投放监控(离线快照) ${params.today}</title>
${REPORT_HTML_STYLE}
</head>
<body>
${buildReportHtmlBody(params)}
</body>
</html>`;
}
