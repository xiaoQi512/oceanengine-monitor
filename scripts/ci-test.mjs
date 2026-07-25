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