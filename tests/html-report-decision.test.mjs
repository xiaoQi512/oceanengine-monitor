// tests/html-report-decision.test.mjs - HTML 报表发送决策测试
import assert from 'node:assert';
import { shouldSendHtmlReport } from '../src/domain/html-report-decision.mjs';

assert.strictEqual(shouldSendHtmlReport({ analysis: {}, enableHtmlReport: false }).send, false);
assert.strictEqual(shouldSendHtmlReport({
  analysis: { active: [{}], summary: { totalSpend: 1 } },
  enableHtmlReport: true,
}).send, true);
assert.strictEqual(shouldSendHtmlReport({
  analysis: { active: [], summary: { totalSpend: 0 } },
  enableHtmlReport: true,
}).reason, 'no_data');

console.log('\n全部测试通过');
