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

// ====== 2026-10-23: 通用跨周期告警冷却 ======
// 根因: 除余额/预算外, 其余告警类型每 15min 周期无条件重发, 同一条件持续数小时即刷屏
// 机制: type 级冷却 —— 同类型在 cooldownMs 内只发一组; severity 升级立即放行; 类型消失即重置状态
export const GENERIC_ALERT_FILE = path.join(DATA_DIR, 'alert-state-generic.json');
const SEV_RANK = { high: 0, medium: 1, low: 2 };

export function loadGenericAlertState() {
  try { if (fs.existsSync(GENERIC_ALERT_FILE)) return JSON.parse(fs.readFileSync(GENERIC_ALERT_FILE, 'utf-8')); } catch {}
  return { map: {} };
}

export function saveGenericAlertState(state) {
  atomicWriteJSON(GENERIC_ALERT_FILE, state);
}

export function filterRecurringAlerts(alerts = [], {
  now = Date.now(),
  cooldownMs = 90 * 60 * 1000,
  load = loadGenericAlertState,
  save = saveGenericAlertState,
} = {}) {
  const state = load();
  const map = state.map || {};

  // 本轮各 type 的最高 severity (同类型多条告警视为一组)
  const topByType = {};
  for (const a of alerts) {
    if (!topByType[a.type] || SEV_RANK[a.severity] < SEV_RANK[topByType[a.type]]) {
      topByType[a.type] = a.severity;
    }
  }

  const out = [];
  for (const a of alerts) {
    const prev = map[a.type];
    let emit;
    if (!prev) {
      emit = true;
    } else {
      const elapsed = now - prev.at;
      const upgraded = SEV_RANK[a.severity] < SEV_RANK[prev.severity];
      emit = upgraded || elapsed >= cooldownMs;
    }
    if (emit) {
      out.push(a);
      map[a.type] = { at: now, severity: topByType[a.type] };
    }
  }

  // 类型消失 → 重置状态 (下轮重新出现立即告警)
  for (const t of Object.keys(map)) {
    if (!topByType[t]) delete map[t];
  }
  save({ map });
  return out;
}
