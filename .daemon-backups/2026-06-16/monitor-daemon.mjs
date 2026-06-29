// monitor-daemon.mjs — 巨量引擎监控守护程序
// 检查 Windows 任务状态 / 日志报错 / 数据间隔 / 服务健康
// 输出结构化健康报告 JSON，供 WorkBuddy 自动化消费

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DATA_DIR, REPORT_DIR, FEEDBACK_PORT, FEISHU_CHAT_ID,
  DAILY_START_HOUR, DAILY_END_HOUR, ACCOUNT_NAME,
  getLocalDate, findLarkCli, checkFeedbackServer, atomicWriteJSON,
} from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(DATA_DIR, 'monitor.log');
const HEALTH_FILE = path.join(DATA_DIR, 'daemon-health.json');
const NODE_EXE = process.execPath;
const LARK_CLI = findLarkCli();

// ====== 1. Windows 任务计划状态 ======
function checkWindowsTasks() {
  const tasks = [];
  try {
    // 写临时 .ps1 文件（UTF-8 BOM），避免 PowerShell 管道中文编码问题
    const psScript = path.join(DATA_DIR, '.task-check.ps1');
    const psCode = [
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      '$taskNames = @("巨量引擎监控", "巨量引擎日报-2305")',
      '$results = @()',
      'foreach ($name in $taskNames) {',
      '  try {',
      '    $t = Get-ScheduledTask -TaskName $name -ErrorAction Stop',
      '    $results += [PSCustomObject]@{ name = $t.TaskName; state = $t.State.ToString() }',
      '  } catch {',
      '    $results += [PSCustomObject]@{ name = $name; state = "NotFound" }',
      '  }',
      '}',
      '$results | ConvertTo-Json -Compress',
    ].join('\n');
    fs.writeFileSync(psScript, '\ufeff' + psCode, 'utf-8');
    const out = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}"`,
      { encoding: 'utf-8', timeout: 10000, windowsHide: true }
    );
    try { fs.unlinkSync(psScript); } catch {}

    const parsed = JSON.parse(out.trim());
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      tasks.push({ name: item.name, state: item.state });
    }
  } catch (e) {
    tasks.push({ name: 'ERROR', state: `powershell查询失败: ${e.message.slice(0, 100)}` });
  }
  return tasks;
}

// ====== 2. 日志错误扫描 ======
function scanLogErrors() {
  const errors = [];
  try {
    if (!fs.existsSync(LOG_FILE)) {
      errors.push({ type: 'missing_log', msg: 'monitor.log 文件不存在' });
      return errors;
    }
    const log = fs.readFileSync(LOG_FILE, 'utf-8');
    const lines = log.split('\n');

    // 取最近 24h 的日志行（基于 monitor.log 只保留最后一次运行的特性）
    const errorPatterns = [
      { regex: /Assignment to constant/, type: 'const_reassign', severity: 'critical' },
      { regex: /ReferenceError/, type: 'reference_error', severity: 'critical' },
      { regex: /SyntaxError/, type: 'syntax_error', severity: 'critical' },
      { regex: /ECONNREFUSED/, type: 'cdp_refused', severity: 'critical' },
      { regex: /❌ 错误/, type: 'script_error', severity: 'high' },
      { regex: /飞书推送.*失败/, type: 'lark_push_fail', severity: 'high' },
      { regex: /数据断层/, type: 'data_gap', severity: 'high' },
      { regex: /降级推送也失败/, type: 'lark_push_double_fail', severity: 'critical' },
      { regex: /⚠ 反馈服务器启动/, type: 'feedback_server_warn', severity: 'medium' },
      { regex: /快照过旧/, type: 'stale_snapshot', severity: 'medium' },
      { regex: /启动超时/, type: 'timeout', severity: 'medium' },
    ];

    for (let i = 0; i < lines.length; i++) {
      for (const pat of errorPatterns) {
        if (pat.regex.test(lines[i])) {
          errors.push({
            type: pat.type,
            severity: pat.severity,
            line: i + 1,
            msg: lines[i].trim().slice(0, 200),
          });
          break; // 一行只匹配一个模式
        }
      }
    }
  } catch (e) {
    errors.push({ type: 'log_read_error', msg: e.message.slice(0, 100), severity: 'high' });
  }
  return errors;
}

// ====== 3. 数据新鲜度检查 ======
function checkDataFreshness() {
  const today = getLocalDate();
  const dailyFile = path.join(DATA_DIR, `daily-${today}.json`);

  if (!fs.existsSync(dailyFile)) {
    return { status: 'missing', hoursSinceLast: null, entryCount: 0, todayFile: false };
  }

  let entries = [];
  try {
    entries = JSON.parse(fs.readFileSync(dailyFile, 'utf-8'));
  } catch {
    return { status: 'corrupted', hoursSinceLast: null, entryCount: 0, todayFile: true };
  }

  if (entries.length === 0) {
    return { status: 'empty', hoursSinceLast: null, entryCount: 0, todayFile: true };
  }

  const lastEntry = entries[entries.length - 1];
  const lastTime = new Date(lastEntry.time || lastEntry.timestamp);
  const hoursSince = (Date.now() - lastTime.getTime()) / 3600000;

  let status = 'fresh';
  if (hoursSince > 2) status = 'stale';
  if (hoursSince > 6) status = 'dead';

  return {
    status,
    hoursSinceLast: hoursSince.toFixed(1),
    entryCount: entries.length,
    lastTime: lastTime.toLocaleString('zh-CN'),
    todayFile: true,
  };
}

// ====== 4. 快照文件检查 ======
function checkSnapshots() {
  const snapshotDir = DATA_DIR; // 快照和 daily JSON 同目录
  try {
    const files = fs.readdirSync(snapshotDir)
      .filter(f => f.match(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/))
      .sort()
      .reverse();

    if (files.length === 0) return { count: 0, lastSnapshot: null, hoursSince: null };

    // 从文件名解析时间
    const lastFile = files[0];
    const match = lastFile.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
    if (!match) return { count: files.length, lastSnapshot: lastFile, hoursSince: null };

    const dt = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}+08:00`);
    const hoursSince = (Date.now() - dt.getTime()) / 3600000;

    return {
      count: files.length,
      lastSnapshot: lastFile,
      lastTime: dt.toLocaleString('zh-CN'),
      hoursSince: hoursSince.toFixed(1),
    };
  } catch {
    return { count: 0, lastSnapshot: null, hoursSince: null };
  }
}

// ====== 5. 反馈服务器状态 ======
async function checkFeedbackHealth() {
  return await checkFeedbackServer();
}

// ====== 6. lark-cli 可用性 ======
function checkLarkCli() {
  if (!LARK_CLI) return { available: false, path: null };
  try {
    if (LARK_CLI.endsWith('.exe')) {
      const r = spawnSync(LARK_CLI, ['--version'], { timeout: 5000, encoding: 'utf-8', windowsHide: true });
      return { available: r.status === 0, path: LARK_CLI };
    } else {
      execSync(`"${LARK_CLI}" --version`, { stdio: 'pipe', timeout: 5000 });
      return { available: true, path: LARK_CLI };
    }
  } catch {
    return { available: false, path: LARK_CLI };
  }
}

// ====== 7. 飞书推送（守护告警） ======
function pushDaemonAlert(report) {
  if (!LARK_CLI) {
    console.log('  ⚠ lark-cli 不可用，跳过守护告警推送');
    return false;
  }

  const criticalCount = report.logErrors.filter(e => e.severity === 'critical').length;
  const highCount = report.logErrors.filter(e => e.severity === 'high').length;
  const mediumCount = report.logErrors.filter(e => e.severity === 'medium').length;

  // 无错误时静默
  if (criticalCount === 0 && highCount === 0 && report.dataFreshness.status === 'fresh') {
    return null; // 不需要推送
  }

  const emoji = criticalCount > 0 ? '🔴' : highCount > 0 ? '🟡' : '🟢';
  const content = JSON.stringify({
    header: {
      title: { tag: 'plain_text', content: `${emoji} 巨量引擎守护报告` },
      template: criticalCount > 0 ? 'red' : highCount > 0 ? 'yellow' : 'green',
    },
    elements: [
      {
        tag: 'markdown',
        content: [
          `**时间**: ${new Date().toLocaleString('zh-CN')}`,
          `**任务状态**: ${report.tasks.map(t => `${t.name}=${t.state}`).join(' / ')}`,
          `**日志错误**: ${criticalCount}严重 ${highCount}高 ${mediumCount}中`,
          `**数据新鲜度**: ${report.dataFreshness.status}（${report.dataFreshness.hoursSinceLast || 'N/A'}h前）`,
          `**快照**: ${report.snapshots.count}个，最新 ${report.snapshots.hoursSince || 'N/A'}h前`,
          `**反馈服务**: ${report.feedbackServer.up ? '✅ 运行中' : report.feedbackServer.up === false ? '❌ 离线' : '—'}`,
          `**飞书通道**: ${report.larkCli.available ? '✅ 可用' : '❌ 不可用'}`,
          '',
          criticalCount > 0 ? '🔴 **严重错误需立即处理！**' : '',
          highCount > 0 ? `🟡 发现 ${highCount} 个高危问题` : '',
        ].filter(Boolean).join('\n'),
      },
      ...(criticalCount + highCount > 0 ? [{
        tag: 'markdown',
        content: report.logErrors
          .filter(e => e.severity === 'critical' || e.severity === 'high')
          .slice(0, 5)
          .map(e => `• [${e.severity}] ${e.msg.slice(0, 120)}`)
          .join('\n'),
      }] : []),
      {
        tag: 'hr',
      },
      {
        tag: 'note',
        elements: [{ tag: 'plain_text', content: '🤖 巨量引擎守护程序 · 自动检测' }],
      },
    ],
  });

  try {
    const tmpFile = path.join(DATA_DIR, '.daemon-alert.json');
    fs.writeFileSync(tmpFile, content);
    if (LARK_CLI.endsWith('.exe')) {
      const r = spawnSync(LARK_CLI, [
        'im', '+messages-send', '--as', 'bot',
        '--msg-type', 'interactive',
        '--chat-id', FEISHU_CHAT_ID,
        '--content', `@${tmpFile}`,
      ], { timeout: 15000, encoding: 'utf-8', windowsHide: true });
      return r.status === 0;
    } else {
      execSync(`"${LARK_CLI}" im +messages-send --as bot --msg-type interactive --chat-id ${FEISHU_CHAT_ID} --content @"${tmpFile}"`, { timeout: 15000, windowsHide: true });
      return true;
    }
  } catch (e) {
    console.log(`  ⚠ 守护告警推送失败: ${e.message.slice(0, 100)}`);
    return false;
  }
}

// ====== 主逻辑 ======
async function main() {
  console.log(`\n[${new Date().toLocaleTimeString('zh-CN')}] 🛡️ 巨量引擎守护检查启动`);

  const report = {
    timestamp: new Date().toISOString(),
    localTime: new Date().toLocaleString('zh-CN'),
    tasks: checkWindowsTasks(),
    logErrors: scanLogErrors(),
    dataFreshness: checkDataFreshness(),
    snapshots: checkSnapshots(),
    feedbackServer: { up: await checkFeedbackHealth() },
    larkCli: checkLarkCli(),
    health: 'unknown',
  };

  // 综合健康判定
  const criticals = report.logErrors.filter(e => e.severity === 'critical').length;
  const highs = report.logErrors.filter(e => e.severity === 'high').length;
  const taskFailures = report.tasks.filter(t => t.state !== 'Ready' && t.state !== 'Running' && t.state !== 'NotFound').length;
  const taskMissing = report.tasks.filter(t => t.state === 'NotFound').length;

  if (criticals > 0 || taskFailures > 0) report.health = 'critical';
  else if (highs > 0 || report.dataFreshness.status === 'dead') report.health = 'warning';
  else if (report.dataFreshness.status === 'stale' || taskMissing > 0) report.health = 'degraded';
  else report.health = 'healthy';

  // 输出报告
  console.log(JSON.stringify(report, null, 2));

  // 持久化
  atomicWriteJSON(HEALTH_FILE, report);

  // 推送告警
  const pushResult = pushDaemonAlert(report);
  if (pushResult === true) console.log('  📨 守护告警已推送飞书');
  else if (pushResult === null) console.log('  ✅ 系统健康，无需推送');
  else console.log('  ⚠ 守护告警推送失败');

  // 输出 exit code 供自动化判断
  if (report.health === 'critical') process.exit(2);
  if (report.health === 'warning') process.exit(1);
  process.exit(0);
}

main().catch(e => {
  console.error('❌ 守护程序异常:', e.message);
  process.exit(3);
});
