// tests/api-snapshot.test.mjs - 5min 快照构建测试
import assert from 'node:assert';
import {
  buildApiSnapshot,
  correctConversionFallback,
  detectCdpZeroSpend,
  computeRecentCpm,
} from '../src/domain/api-snapshot.mjs';

const snap = buildApiSnapshot(
  { todaySpend: 10, todayBudget: 100, balance: 5 },
  { projects: [{ project_id: 'p1', project_status_name: '投放中', metrics: { stat_cost: '10' } }] },
  '2026-08-02T01:00:00Z'
);
assert.strictEqual(snap.accountSpend, 10);
assert.strictEqual(snap.activeCount, 1);
assert.deepStrictEqual(correctConversionFallback({ totalConv: 0 }, [{ totalConv: 2 }]), { totalConv: 2, from: 'api_fallback' });
assert.strictEqual(detectCdpZeroSpend({ _method: 'cdp', accountSpend: 0 }, [{ accountSpend: 5 }]).skip, true);
assert.strictEqual(computeRecentCpm({ impressions: 20 }, { last5min: 10 }, [{ impressions: 10 }]), 1000);

console.log('\n全部测试通过');
