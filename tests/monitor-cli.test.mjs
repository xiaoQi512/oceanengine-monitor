// tests/monitor-cli.test.mjs - 通用 CLI 错误处理测试
import assert from 'node:assert';
import { runMonitorCli } from '../src/services/monitor-cli.mjs';

let exitCode = null;
await runMonitorCli({ run: async () => {}, onExit: code => { exitCode = code; } });
assert.strictEqual(exitCode, null);

let successResult = null;
await runMonitorCli({
  run: async () => 'ok',
  onSuccess: result => { successResult = result; },
  onExit: code => { exitCode = code; },
});
assert.strictEqual(successResult, 'ok');
assert.strictEqual(exitCode, null);

let errorMsg = null;
await runMonitorCli({
  run: async () => { throw new Error('boom'); },
  onError: msg => { errorMsg = msg; },
  onExit: code => { exitCode = code; },
});
assert.strictEqual(errorMsg, 'boom');
assert.strictEqual(exitCode, 1);

exitCode = null;
await runMonitorCli({
  run: async () => { throw new Error('ignore'); },
  onError: async () => { throw new Error('record failed'); },
  onExit: code => { exitCode = code; },
});
assert.strictEqual(exitCode, 1);

console.log('\n全部测试通过');
