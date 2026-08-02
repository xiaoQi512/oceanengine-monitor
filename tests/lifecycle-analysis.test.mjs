// tests/lifecycle-analysis.test.mjs - 生命周期推断测试
import assert from 'node:assert';
import { computeLifecycleFromSnapshots } from '../src/domain/lifecycle-analysis.mjs';

const now = new Date('2026-08-01T12:00:00Z').getTime();
const lifecycle = computeLifecycleFromSnapshots(
  [{ id: 'c1', spend: 50 }],
  [{ time: new Date('2026-08-01T06:00:00Z').toISOString(), active: [{ id: 'c1', spend: 0 }] }],
  null,
  now
);
assert.strictEqual(lifecycle.dead, 1);
assert.strictEqual(lifecycle.active, 0);

const revivedCampaign = { id: 'c2', spend: 500 };
const revived = computeLifecycleFromSnapshots(
  [revivedCampaign],
  [{ time: new Date('2026-08-01T11:00:00Z').toISOString(), active: [{ id: 'c2', spend: 0 }] }],
  { active: [{ id: 'c2', _lifecycle: 'dead' }] },
  now
);
assert.strictEqual(revived.active, 1);
assert.strictEqual(revivedCampaign._justRevived, true);

console.log('\n全部测试通过');
