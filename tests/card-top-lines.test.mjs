// tests/card-top-lines.test.mjs - 卡片 TOP/基线测试
import assert from 'node:assert';
import { buildTopSpendLines } from '../src/domain/card-top-lines.mjs';
import { buildYoyContent, buildLifecycleContent } from '../src/domain/card-baselines.mjs';

assert.strictEqual(buildTopSpendLines([], 15).length, 0);
assert.ok(buildTopSpendLines([{ name: 'A', spendDelta: 10, changeRate: 0.2, spendPrev: 1, convDelta: 1 }], 15)[0].includes('TOP5'));
assert.ok(buildYoyContent({ yoy: { spendVsYesterday: 0.1, cpaVsYesterday: 0, yesterdaySpend: 10, yesterdayCPA: 10, yesterdayDate: '2026-08-01' } }, { totalSpend: 20, avgCPA: 10 }).includes('同比'));
assert.ok(buildLifecycleContent({ lifecycle: { dead: 1, active: 1 } }).includes('疑似死亡'));

console.log('\n全部测试通过');
