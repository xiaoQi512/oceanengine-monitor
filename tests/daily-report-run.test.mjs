// tests/daily-report-run.test.mjs - 日报运行编排入口测试
import assert from 'node:assert';
import { runDailyReport } from '../src/services/daily-report-run.mjs';

assert.strictEqual(typeof runDailyReport, 'function');

console.log('\n全部测试通过');
