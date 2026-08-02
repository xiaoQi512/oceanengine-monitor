// tests/daily-report-collect.test.mjs - 日报最终采集测试
import assert from 'node:assert';
import { collectFinalMonitorData } from '../src/services/daily-report-collect.mjs';

let called = false;
const fresh = await collectFinalMonitorData({
  node: 'node',
  script: 'script.mjs',
  projectRoot: '.',
  httpGetFn: (url, opts, cb) => {
    const res = { on(event, fn) { if (event === 'end') fn(); } };
    cb(res);
    return { on() {}, destroy() {} };
  },
  execSyncFn: () => { called = true; },
  logFn: () => {},
});
assert.strictEqual(fresh, true);
assert.strictEqual(called, true);

console.log('\n全部测试通过');
