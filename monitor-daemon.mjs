// monitor-daemon.mjs — 巨量引擎监控守护程序 (v2)
// 检查 Windows 任务状态 / 日志报错 / 数据间隔 / 服务健康
// v2: 增强 CDP 自动恢复 + Chrome 拉起能力
// 输出结构化健康报告 JSON，供 WorkBuddy 自动化消费

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  DATA_DIR, REPORT_DIR, FEEDBACK_PORT, FEISHU_CHAT_ID,
  getTodayShiftWindow, ACCOUNT_NAME, CAMPAIGN_URL,
  CHROME_USER_DATA_DIR, CHROME_PROFILE_DIRECTORY, findChromeExe,
  getLocalDate, findLarkCli, checkFeedbackServer, atomicWriteJSON,
} from './monitor-utils.mjs';
import { checkCDP, getOceanEngineTab } from './cdp-client.mjs';

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
  const currentHour = new Date().getHours();
  const shiftWin = getTodayShiftWindow();
  const isMonitoringHours = currentHour >= shiftWin.startHour && currentHour <= shiftWin.endHour;

  if (!fs.existsSync(dailyFile)) {
    // 监控时段内没有当日数据文件 -> 严重（本该有数据但缺失）
    const status = isMonitoringHours ? 'missing_active' : 'missing';
    return { status, hoursSinceLast: null, entryCount: 0, todayFile: false, isMonitoringHours };
  }

  let entries = [];
  try {
    entries = JSON.parse(fs.readFileSync(dailyFile, 'utf-8'));
  } catch {
    return { status: 'corrupted', hoursSinceLast: null, entryCount: 0, todayFile: true, isMonitoringHours };
  }

  if (entries.length === 0) {
    const status = isMonitoringHours ? 'empty_active' : 'empty';
    return { status, hoursSinceLast: null, entryCount: 0, todayFile: true, isMonitoringHours };
  }

  // 过滤掉 data_gap 条目，只看有真实数据的最后一条
  const realEntries = entries.filter(e => e.type !== 'data_gap');
  if (realEntries.length === 0) {
    // 全部都是 data_gap -> 等价于空但有文件
    return { status: 'all_gaps', hoursSinceLast: null, entryCount: entries.length, todayFile: true, isMonitoringHours };
  }

  const lastEntry = realEntries[realEntries.length - 1];
  const lastTime = new Date(lastEntry.time || lastEntry.timestamp);
  const hoursSince = (Date.now() - lastTime.getTime()) / 3600000;

  let status = 'fresh';
  if (hoursSince > 1 && isMonitoringHours) status = 'stale';       // 监控时段：1h即过旧
  else if (hoursSince > 2) status = 'stale';                        // 非监控时段：2h才过旧
  if (hoursSince > 3 && isMonitoringHours) status = 'dead';        // 监控时段：3h即死亡
  else if (hoursSince > 6) status = 'dead';                         // 非监控时段：6h才死亡

  return {
    status,
    hoursSinceLast: hoursSince.toFixed(1),
    entryCount: entries.length,
    realEntryCount: realEntries.length,
    lastTime: lastTime.toLocaleString('zh-CN'),
    todayFile: true,
    isMonitoringHours,
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

    const dt = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
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

// ====== 6. Chrome CDP 连通性检查 ======
function checkChromeCDP_direct() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:9222/json/version', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ reachable: true, browser: json.Browser || 'unknown', webSocket: json.webSocketDebuggerUrl || '' });
        } catch {
          resolve({ reachable: false, browser: null, error: 'parse_fail' });
        }
      });
    });
    req.on('error', (e) => resolve({ reachable: false, browser: null, error: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false, browser: null, error: 'timeout' }); });
  });
}

// ====== 6b. Chrome CDP 自动恢复 (v2 新增) ======
async function recoverChromeCDP() {
  console.log('  🔧 尝试 CDP 自动恢复...');

  // 步骤1: 检查CDP是否真的不可达
  const cdpStatus = await checkCDP();
  if (cdpStatus.reachable) {
    console.log('  ✅ CDP 实际可达，检查是否有巨量引擎标签页...');
    const tab = await getOceanEngineTab(['投放管理', '巨量引擎工作台']);
    if (tab) {
      console.log(`  ✅ 标签页正常: ${tab.title?.substring(0, 60)}`);
      return { recovered: true, action: 'no_fix_needed' };
    }
    console.log('  ⚠ CDP可达但无巨量引擎标签页，尝试导航...');
    // 尝试打开新标签页
    try {
      // 使用最后一个可用标签页
      const resp = await fetch('http://localhost:9222/json/list');
      const tabs = await resp.json();
      const lastTab = tabs.find(t => t.type === 'page');
      if (lastTab) {
        const { createCDPClient } = await import('./cdp-client.mjs');
        const client = await createCDPClient(lastTab.webSocketDebuggerUrl);
        await client.call('Page.navigate', { url: CAMPAIGN_URL });
        console.log('  ✅ 已导航到投放管理页');
        client.close();
        return { recovered: true, action: 'navigated' };
      }
    } catch (e) {
      console.log(`  ⚠ 导航失败: ${e.message}`);
    }
    return { recovered: false, action: 'no_tab' };
  }

  // 步骤2: CDP 不可达 → 尝试拉 Chrome
  console.log('  📡 CDP 不可达，尝试拉起 Chrome...');
  const chromeExe = findChromeExe();
  if (!chromeExe) {
    console.log('  ❌ 未找到 Chrome 安装路径');
    return { recovered: false, action: 'no_chrome_exe' };
  }

  try {
    const userDataDir = CHROME_USER_DATA_DIR;
    const args = [
      `--remote-debugging-port=9222`,
      `--user-data-dir=${userDataDir}`,
      `--profile-directory=${CHROME_PROFILE_DIRECTORY}`,
      '--no-first-run',
      '--no-default-browser-check',
      CAMPAIGN_URL,
    ];

    const child = spawn(chromeExe, args, {
      detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.unref();

    // 等待CDP就绪（最多30秒）
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await checkCDP().then(r => r.reachable)) {
        console.log('  ✅ Chrome CDP 已恢复 (9222端口)');
        return { recovered: true, action: 'chrome_launched' };
      }
    }

    console.log('  ⚠ Chrome 启动超时，CDP仍不可达');
    return { recovered: false, action: 'chrome_timeout' };
  } catch (e) {
    console.log(`  ❌ Chrome 启动失败: ${e.message}`);
    return { recovered: false, action: `launch_failed: ${e.message.slice(0, 60)}` };
  }
}

// ====== 7. lark-cli 可用性 ======
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

  // 无错误且 CDP 连通且数据新鲜时静默
  const dfOk = report.dataFreshness.status === 'fresh' || report.dataFreshness.status === 'missing' || report.dataFreshness.status === 'empty';
  if (criticalCount === 0 && highCount === 0 && report.chromeCDP.reachable && dfOk) {
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
          `**Chrome CDP**: ${report.chromeCDP.reachable ? '✅ 连通' : '❌ 断开（'+report.chromeCDP.error+'）'}${report.cdpRecovery ? ' → ' + (report.cdpRecovery.recovered ? '✅ 已恢复('+report.cdpRecovery.action+')' : '❌ 恢复失败') : ''}`,
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
  } finally {
    try { fs.unlinkSync(path.join(DATA_DIR, '.daemon-alert.json')); } catch {}
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
    chromeCDP: await checkChromeCDP_direct(),
    larkCli: checkLarkCli(),
    health: 'unknown',
  };

  // 综合健康判定
  const criticals = report.logErrors.filter(e => e.severity === 'critical').length;
  const highs = report.logErrors.filter(e => e.severity === 'high').length;
  const taskFailures = report.tasks.filter(t => t.state !== 'Ready' && t.state !== 'Running' && t.state !== 'NotFound').length;
  const taskMissing = report.tasks.filter(t => t.state === 'NotFound').length;
  const dfStatus = report.dataFreshness.status;
  const isMonitoringHours = report.dataFreshness.isMonitoringHours;

  // 🔴 Chrome CDP 断开 → critical（最根本的故障源头）
  if (!report.chromeCDP.reachable && isMonitoringHours) report.health = 'critical';
  else if (criticals > 0 || taskFailures > 0) report.health = 'critical';
  // 🟡 监控时段内数据缺失/全断层/死亡 → warning
  else if (highs > 0 || dfStatus === 'dead' || dfStatus === 'missing_active' || dfStatus === 'empty_active' || dfStatus === 'all_gaps') report.health = 'warning';
  // 🟡 非监控时段的 stale + 任务缺失 → degraded
  else if (dfStatus === 'stale' || taskMissing > 0) report.health = 'degraded';
  else report.health = 'healthy';

  // ====== v2: CDP 自动恢复 ======
  if (!report.chromeCDP.reachable && isMonitoringHours) {
    console.log('  🔴 CDP 断开（监控时段），尝试自动恢复...');
    report.cdpRecovery = await recoverChromeCDP();
    if (report.cdpRecovery.recovered) {
      console.log('  ✅ CDP 恢复成功，重新检查 CDP 状态...');
      report.chromeCDP = await checkChromeCDP_direct();
      if (report.chromeCDP.reachable && report.cdpRecovery.action === 'chrome_launched') {
        // Chrome 刚拉起，等待页面加载
        await new Promise(r => setTimeout(r, 5000));
        report.chromeCDP = await checkChromeCDP_direct();
      }
      // 如果 CDP 恢复了，可能可以将健康状态降级
      if (report.chromeCDP.reachable && report.health === 'critical' && criticals === 0) {
        // 唯一的 critical 因子是 CDP，现在 CDP 恢复了
        if (highs > 0 || dfStatus === 'dead') {
          report.health = 'warning';
        } else {
          report.health = 'degraded';
        }
        console.log(`  📉 健康状态降级: critical → ${report.health}`);
      }
    }
  }

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
