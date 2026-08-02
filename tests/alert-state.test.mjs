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
