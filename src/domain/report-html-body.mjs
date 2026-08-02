// src/domain/report-html-body.mjs - 离线报表正文组合
import { buildReportHtmlHeader } from './report-html-body-header.mjs';
import { buildReportHtmlSections } from './report-html-body-sections.mjs';
import { buildReportHtmlFooter } from './report-html-body-footer.mjs';

export function buildReportHtmlBody(params) {
  return buildReportHtmlHeader(params) + buildReportHtmlSections(params) + buildReportHtmlFooter(params);
}
