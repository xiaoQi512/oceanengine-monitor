// tests/alert-state.test.mjs - 余额/预算告警状态测试
import assert from 'node:assert';
import { loadBalanceAlertState, saveBalanceAlertState, loadAccountBudgetAlertState, saveAccountBudgetAlertState } from '../src/services/alert-state.mjs';

assert.strictEqual(typeof loadBalanceAlertState, 'function');
assert.strictEqual(typeof saveBalanceAlertState, 'function');
assert.strictEqual(typeof loadAccountBudgetAlertState, 'function');
assert.strictEqual(typeof saveAccountBudgetAlertState, 'function');
assert.strictEqual(typeof loadBalanceAlertState().lastSeverity, 'string');
assert.strictEqual(typeof loadAccountBudgetAlertState().lastPct, 'number');

console.log('\n全部测试通过');

// ===== 2026-10-23: 通用跨周期告警冷却 =====
import { filterRecurringAlerts, loadGenericAlertState } from '../src/services/alert-state.mjs';
const mem = { v: null };
const load = () => mem.v || { map: {} };
const save = (s) => { mem.v = s; };
const A = (type, severity) => ({ type, severity, name: type });
const MIN = 60000;
let t0 = 1000000;

const r1 = filterRecurringAlerts([A('dropping', 'medium'), A('speed_spike', 'high')], { now: t0, load, save });
assert.strictEqual(r1.length, 2, '首次全发');
const r2 = filterRecurringAlerts([A('dropping', 'medium'), A('speed_spike', 'high')], { now: t0 + 10 * MIN, load, save });
assert.strictEqual(r2.length, 0, '冷却期内压制');
const r3 = filterRecurringAlerts([A('dropping', 'high')], { now: t0 + 20 * MIN, load, save });
assert.strictEqual(r3.length, 1, 'severity 升级放行');
const r4 = filterRecurringAlerts([A('dropping', 'high')], { now: t0 + 30 * MIN, load, save });
assert.strictEqual(r4.length, 0, '同级不重发');
const r5 = filterRecurringAlerts([A('dropping', 'medium')], { now: t0 + 40 * MIN, load, save });
assert.strictEqual(r5.length, 0, '降级不重发');
const r6 = filterRecurringAlerts([A('pacing_fast', 'medium')], { now: t0 + 50 * MIN, load, save });
assert.strictEqual(r6.length, 1, '类型消失后重现立即告警(状态已重置)');
const r7 = filterRecurringAlerts([A('pacing_fast', 'medium')], { now: t0 + 141 * MIN, load, save });
assert.strictEqual(r7.length, 1, '冷却期满放行');
assert.ok(loadGenericAlertState, '真实状态函数存在');
console.log('filterRecurringAlerts 用例通过');
