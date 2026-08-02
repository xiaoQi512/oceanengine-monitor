// scripts/ci-test.mjs - CI 测试运行器
// 逐个运行适合 CI 的纯逻辑测试，超时控制，结果收集
// 不依赖网络/端口/Chrome/数据库的测试才纳入 CI
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// 适合 CI 的测试文件（纯逻辑，不依赖外部资源）
const CI_TESTS = [
  'tests/csrf.test.mjs',
  'tests/autonomous-router.test.mjs',
  'tests/feishu-push-guard.test.mjs',
  'tests/refactor-compat.test.mjs',
  'tests/http-routes.test.mjs',
  'tests/domain-helpers.test.mjs',
  'tests/domain-outputs.test.mjs',
  'tests/domain-analysis.test.mjs',
  'scripts/check-imports.mjs',
  'tests/api-client-injection.test.mjs',
  'tests/domain-alerts.test.mjs',
  'tests/domain-analyze.test.mjs',
  'tests/domain-rolling.test.mjs',
  'tests/domain-quick-card.test.mjs',
  'tests/domain-detailed-card.test.mjs',
  'tests/db-migration-readiness.test.mjs',
  'tests/db-compat-write.test.mjs',
  'tests/domain-five-minute-logic.test.mjs',
  'tests/snapshot-store.test.mjs',
  'tests/page-actions.test.mjs',
  'tests/monitor-scraper.test.mjs',
  'tests/page-setup.test.mjs',
  'tests/monitor-chrome.test.mjs',
  'tests/push-state.test.mjs',
  'tests/monitor-state.test.mjs',
  'tests/alert-state.test.mjs',
  'tests/alert-push.test.mjs',
  'tests/monitor-push.test.mjs',
  'tests/monitor-summary.test.mjs',
  'tests/monitor-io.test.mjs',
  'tests/monitor-collect.test.mjs',
  'tests/monitor-runtime.test.mjs',
  'tests/monitor-card.test.mjs',
  'tests/monitor-report.test.mjs',
  'tests/analysis-context.test.mjs',
  'tests/monitor-config.test.mjs',
  'tests/monitor-cli.test.mjs',
  'tests/monitor-cycle.test.mjs',
  'tests/five-min-snapshot.test.mjs',
  'tests/five-min-push.test.mjs',
  'tests/five-min-detailed-push.test.mjs',
  'tests/five-min-collect.test.mjs',
  'tests/five-min-push-state.test.mjs',
  'tests/five-min-cycle.test.mjs',
  'scripts/smoke-monitor-cycles.mjs',
  'scripts/check-pm2-paths.mjs',
  'scripts/check-env-example.mjs',
  'scripts/check-root-entries.mjs',
  'scripts/check-refactor-status.mjs',
  'tests/action-store.test.mjs',
  'tests/feishu-listener-state.test.mjs',
  'tests/feishu-listener-commands.test.mjs',
  'tests/feishu-listener-messaging.test.mjs',
  'tests/feishu-listener-actions.test.mjs',
  'tests/feishu-listener-ai.test.mjs',
  'tests/feishu-listener-dispatch.test.mjs',
  'tests/feishu-listener-run.test.mjs',
  'tests/action-executor.test.mjs',
  'tests/action-worker-run.test.mjs',
  'tests/http-analysis.test.mjs',
  'tests/shift-pusher-state.test.mjs',
  'tests/shift-pusher-schedule.test.mjs',
  'tests/shift-pusher-eod.test.mjs',
  'tests/shift-pusher-run.test.mjs',
  'tests/shift-sync.test.mjs',
  'tests/shift-pusher-shift.test.mjs',
  'tests/ai-regions-core.test.mjs',
  'tests/daily-summary-core.test.mjs',
  'tests/daily-report-core.test.mjs',
  'tests/alert-cards.test.mjs',
  'tests/http-feedback-store.test.mjs',
  'tests/five-min-detailed-context.test.mjs',
  'tests/daily-report-run.test.mjs',
  'tests/feishu-listener-handlers.test.mjs',
  'tests/action-process.test.mjs',
  'tests/live-watcher-run.test.mjs',
  'tests/http-snapshot.test.mjs',
  'tests/http-delivery.test.mjs',
  'tests/http-effect.test.mjs',
  'tests/daily-report-push.test.mjs',
  'tests/shift-pusher-message.test.mjs',
  'tests/daily-report-data.test.mjs',
  'tests/daily-summary-common.test.mjs',
  'tests/shift-pusher-snapshot.test.mjs',
  'tests/daily-report-insights.test.mjs',
  'tests/daily-report-slots.test.mjs',
  'tests/daily-report-collect.test.mjs',
  'tests/shift-pusher-sheet.test.mjs',
  'tests/shift-pusher-fetch.test.mjs',
  'tests/daily-report-html.test.mjs',
  'tests/five-min-context.test.mjs',
  'tests/daily-report-comparison.test.mjs',
  'tests/effect-rules.test.mjs',
  'tests/ai-context-prompt.test.mjs',
  'tests/action-guard.test.mjs',
  'tests/daily-report-wait.test.mjs',
  'tests/shift-metrics.test.mjs',
  'tests/snapshot-time.test.mjs',
  'tests/ai-regions-stats.test.mjs',
  'tests/feishu-command-parser.test.mjs',
  'tests/campaign-index.test.mjs',
  'tests/trend-analysis.test.mjs',
  'tests/baseline-analysis.test.mjs',
  'tests/window-analysis.test.mjs',
  'tests/lifecycle-analysis.test.mjs',
  'tests/quick-card-top.test.mjs',
  'tests/progress-bar.test.mjs',
  'tests/monitor-summary-lines.test.mjs',
  'tests/feishu-listener-queue.test.mjs',
  'tests/ai-regions-api.test.mjs',
  'tests/api-normalization.test.mjs',
  'tests/api-snapshot.test.mjs',
  'tests/five-minute-schedule.test.mjs',
  'tests/parse-utils.test.mjs',
  'tests/delivery-summary.test.mjs',
  'tests/card-sections.test.mjs',
  'tests/card-alert-classifier.test.mjs',
  'tests/daily-log-entry.test.mjs',
  'tests/html-report-decision.test.mjs',
  'tests/shift-pusher-cache.test.mjs',
  'tests/daily-summary-request.test.mjs',
  'tests/snapshot-file.test.mjs',
  'tests/snapshot-db.test.mjs',
  'tests/feishu-message-format.test.mjs',
  'tests/pending-suggestions.test.mjs',
  'tests/alert-card-lines.test.mjs',
  'tests/shift-schedule.test.mjs',
  'tests/effect-evaluation.test.mjs',
  'tests/five-min-cycle-log.test.mjs',
  'tests/action-result.test.mjs',
  'tests/shift-pusher-lark.test.mjs',
  'tests/action-process-steps.test.mjs',
  'tests/report-html-parts.test.mjs',
  'tests/alert-modules.test.mjs',
  'tests/campaign-analysis.test.mjs',
  'tests/card-top-lines.test.mjs',
  'tests/api-actions-core.test.mjs',
];

const TIMEOUT_MS = 15000;

const PASS_PATTERNS = [/全部通过/, /全部测试通过/, /passed,?\s*0\s*failed/];
const FAIL_PATTERNS = [/\u274c/, /[1-9]\d*\s*failed/];

function checkOutput(stdout) {
  const hasPass = PASS_PATTERNS.some(p => p.test(stdout));
  const hasFail = FAIL_PATTERNS.some(p => p.test(stdout));
  return hasPass && !hasFail;
}

function runTest(file) {
  return new Promise((resolve) => {
    const nodeExe = process.env.NODE_EXE || process.execPath;
    const child = spawn(nodeExe, [path.join(PROJECT_ROOT, file)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: PROJECT_ROOT,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
    }, TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      // feishu-push-guard 等测试通过后进程不退出（import 链持有事件循环）
      // 超时 kill 时检查输出中是否有通过标记
      const passed = timedOut ? checkOutput(stdout) : code === 0;
      resolve({ file, passed, code, timedOut, stdout: stdout.slice(-800), stderr: stderr.slice(-800) });
    });
  });
}

async function main() {
  console.log(`CI test runner - ${CI_TESTS.length} test files\n`);
  const results = [];
  for (const file of CI_TESTS) {
    process.stdout.write(`  ${file} ... `);
    const r = await runTest(file);
    results.push(r);
    if (r.passed) {
      console.log('PASS' + (r.timedOut ? ' (timeout-killed, tests passed)' : ''));
    } else {
      console.log('FAIL');
      if (r.stdout) console.log('  stdout:', r.stdout);
      if (r.stderr) console.log('  stderr:', r.stderr);
    }
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed` + (failed > 0 ? `, ${failed} failed` : ''));
  process.exit(failed > 0 ? 1 : 0);
}

main();
