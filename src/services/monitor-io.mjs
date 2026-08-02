// src/services/monitor-io.mjs - 15min 监控文件落盘与报表发送
import fs from 'node:fs';
import path from 'node:path';
import { buildDailyLogEntry } from '../domain/daily-log-entry.mjs';
import { shouldSendHtmlReport } from '../domain/html-report-decision.mjs';

export function saveDailyLog(analysis, { dataDir, getLocalDate, atomicWriteJSON }) {
  const today = getLocalDate();
  const logFile = path.join(dataDir, `daily-${today}.json`);
  let log = [];
  if (fs.existsSync(logFile)) {
    try { log = JSON.parse(fs.readFileSync(logFile, 'utf-8')); } catch {}
  }
  log.push(buildDailyLogEntry(analysis));
  atomicWriteJSON(logFile, log);
}

export function saveSnapshot({
  analysis,
  timestamp,
  dataDir,
  atomicWriteJSON,
  dualInsertSnapshot,
  verifyConsistency,
}) {
  const jsonFile = path.join(dataDir, `${timestamp}.json`);
  let jsonOk = false;
  let sqliteRows = 0;

  try {
    atomicWriteJSON(jsonFile, analysis);
    jsonOk = true;
  } catch (e) {
    console.warn(`  ⚠ JSON 快照写入失败: ${e.message}`);
  }

  try {
    const r = dualInsertSnapshot(analysis, timestamp);
    if (r.ok && r.rows > 0) {
      sqliteRows = r.rows;
      const v = verifyConsistency(analysis, timestamp);
      if (!v.ok && v.warn) {
        console.warn(`  ⚠ SQLite一致性校验: ${v.warn}`);
      }
      console.log(`  📊 SQLite双写: ${r.rows} 条 (jsonOk=${jsonOk})`);
    }
  } catch (e) {
    console.warn(`  ⚠ SQLite 双写失败: ${e.message}`);
  }

  return { jsonOk, sqliteRows };
}

export function writeHtmlReport({ analysis, reportDir, generateHTML }) {
  const html = generateHTML(analysis);
  const htmlFile = path.join(reportDir, 'oceanengine-report.html');
  const htmlTmp = htmlFile + '.tmp';
  fs.writeFileSync(htmlTmp, html);
  fs.renameSync(htmlTmp, htmlFile);
  return htmlFile;
}

export async function sendReportFileToChat({ config, pushFile }) {
  if (!config.larkCli) {
    console.log('  ⚠ lark-cli 不可用，跳过报表文件发送');
    return false;
  }
  const htmlFile = path.join(config.reportDir, 'oceanengine-report.html');
  if (!fs.existsSync(htmlFile)) {
    console.log('  ⚠ 报表文件不存在，跳过发送');
    return false;
  }

  const result = await pushFile(config.larkCli, htmlFile, config.feishuChatId, config.reportDir, {
    timeoutMs: 30000,
    maxRetries: 1,
  });

  if (result.ok) {
    console.log('  📄 详实报表HTML文件已发送到群聊');
    return true;
  }
  console.log(`  ❌ 报表文件发送异常: ${result.error || 'unknown'}`);
  if (result.fallback) {
    console.log(`  📁 已 fallback 到本地日志: ${result.path}`);
  }
  return false;
}

export async function sendReportIfEnabled({ analysis, config, pushFile, htmlFile }) {
  const decision = shouldSendHtmlReport({ analysis, enableHtmlReport: config.enableHtmlReport });
  if (!decision.send && decision.reason === 'disabled') {
    console.log('  ⏭ HTML 报表已关闭，跳过报表文件发送');
    return false;
  }
  if (!decision.send && decision.reason === 'no_data') {
    console.log('  ⏭ 无有效数据，跳过报表文件发送');
    return false;
  }

  const ok = await sendReportFileToChat({ config, pushFile });
  if (htmlFile) {
    console.log(`\n📄 报表: ${htmlFile}`);
  }
  return ok;
}
