// tests/alert-modules.test.mjs - 告警子模块测试
import assert from 'node:assert';
import { buildWindow3hAlerts } from '../src/domain/window-alerts.mjs';
import { buildMultiDayAlerts } from '../src/domain/multiday-alerts.mjs';
import { buildCampaignAlerts, buildAccountBudgetAlerts } from '../src/domain/plan-alerts.mjs';

const windowAlerts = buildWindow3hAlerts({
  speed: { change: 0.8, first: 10, second: 100 },
  spend: { second: 500 },
  secondHours: '1.5',
  firstHours: '1.5',
  cpa: { first: 0, second: 0, change: 0 },
  convRate: { change: 0, second: 0 },
  burnRate: { change: 0, second: 0 },
});
assert.ok(windowAlerts.some(a => a.type === 'speed_3h'));
assert.strictEqual(buildMultiDayAlerts({ multiDay: null }).length, 0);
assert.strictEqual(buildCampaignAlerts([], 0).length, 0);
assert.strictEqual(buildAccountBudgetAlerts(0, 0).length, 0);

console.log('\n全部测试通过');
