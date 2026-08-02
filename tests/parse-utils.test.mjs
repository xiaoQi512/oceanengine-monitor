// tests/parse-utils.test.mjs - 解析工具测试
import assert from 'node:assert';
import { parsePlanBudget, parseSnapshotTime } from '../src/domain/parse-utils.mjs';

assert.strictEqual(parsePlanBudget('10,000.00按日预算'), 10000);
assert.strictEqual(parsePlanBudget(200), 200);
assert.strictEqual(parsePlanBudget(''), 0);
assert.ok(parseSnapshotTime('2026-08-02T01-00-00.json') > 0);

console.log('\n全部测试通过');
