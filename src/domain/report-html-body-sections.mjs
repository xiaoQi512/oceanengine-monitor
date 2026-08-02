// src/domain/report-html-body-sections.mjs - 报表主体区块组合
import { buildReportHtmlLists } from './report-html-body-lists.mjs';
import { buildReportHtmlTrends } from './report-html-body-trends.mjs';

export function buildReportHtmlSections(params) {
  return buildReportHtmlLists(params) + buildReportHtmlTrends(params);
}
