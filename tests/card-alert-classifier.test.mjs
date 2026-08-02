// tests/card-alert-classifier.test.mjs - 卡片告警分类测试
import assert from 'node:assert';
import { classifyCardAlerts, buildAlertLines } from '../src/domain/card-alert-classifier.mjs';

const result = classifyCardAlerts([
  { type: 'zero_conv', severity: 'high' },
  { type: 'budget', severity: 'medium' },
]);
assert.strictEqual(result.highAlerts.length, 1);
assert.strictEqual(result.infoAlerts.length, 1);
assert.ok(buildAlertLines([{ name: '预算', detail: '详情' }]).length > 0);

console.log('\n全部测试通过');
