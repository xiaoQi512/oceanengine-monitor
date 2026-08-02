// src/services/alert-state.mjs - 余额/预算告警状态
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, atomicWriteJSON } from '../utils/monitor-utils.mjs';

export const BALANCE_ALERT_FILE = path.join(DATA_DIR, 'balance-alert-last.json');
export const ACCOUNT_BUDGET_ALERT_FILE = path.join(DATA_DIR, 'account-budget-alert-last.json');

export function loadBalanceAlertState() {
  try { if (fs.existsSync(BALANCE_ALERT_FILE)) return JSON.parse(fs.readFileSync(BALANCE_ALERT_FILE, 'utf-8')); } catch {}
  return { lastPush: 0, lastSeverity: '' };
}

export function saveBalanceAlertState(state) {
  atomicWriteJSON(BALANCE_ALERT_FILE, state);
}

export function loadAccountBudgetAlertState() {
  try { if (fs.existsSync(ACCOUNT_BUDGET_ALERT_FILE)) return JSON.parse(fs.readFileSync(ACCOUNT_BUDGET_ALERT_FILE, 'utf-8')); } catch {}
  return { lastPush: 0, lastSeverity: '', lastPct: 0 };
}

export function saveAccountBudgetAlertState(state) {
  atomicWriteJSON(ACCOUNT_BUDGET_ALERT_FILE, state);
}
