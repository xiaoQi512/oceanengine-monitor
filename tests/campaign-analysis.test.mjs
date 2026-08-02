// tests/campaign-analysis.test.mjs - 分析子模块测试
import assert from 'node:assert';
import { classifyCampaigns, buildStatusLabels } from '../src/domain/campaign-classification.mjs';
import { buildCampaignDeltas } from '../src/domain/campaign-deltas.mjs';
import { computePacing } from '../src/domain/pacing-analysis.mjs';
import { calibrateWithPageSummary } from '../src/domain/page-calibration.mjs';

const { allSpending, active } = classifyCampaigns([
  { spend: 1, status: '投放中' },
  { spend: 0, status: '暂停' },
]);
assert.strictEqual(allSpending.length, 1);
assert.strictEqual(active.length, 1);
assert.strictEqual(buildStatusLabels(allSpending)[0].label, '投放中');
const deltas = buildCampaignDeltas([{ id: 'a', spend: 10, conversions: 1 }], new Map([['a', { spend: 4, conversions: 0 }]]));
assert.strictEqual(deltas[0].spendDelta, 6);
const pacing = computePacing({ now: new Date(2026, 7, 2, 12, 0), dailyStartHour: 9, dailyEndHour: 23, effectiveBudget: 1000, totalSpend: 100 });
assert.strictEqual(pacing.timeSlot, '午高峰');
const cal = calibrateWithPageSummary({ pageSummary: null, totalSpend: 1 });
assert.strictEqual(cal.totalSpend, 1);

console.log('\n全部测试通过');
