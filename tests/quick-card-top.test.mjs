// tests/quick-card-top.test.mjs - 速报 TOP5 增量测试
import assert from 'node:assert';
import { buildTop5DeltaLines } from '../src/domain/quick-card-top.mjs';

const lines = buildTop5DeltaLines(
  { allSpending: [{ id: 'a', name: 'A', spend: 20, conversions: 2 }] },
  [{ allSpending: [{ id: 'a', name: 'A', spend: 10, conversions: 1 }] }]
);
assert.ok(lines.includes('+¥10'));
assert.ok(lines.includes('A'));
assert.strictEqual(buildTop5DeltaLines({ allSpending: [] }, []), '暂无增量');

console.log('\n全部测试通过');
