// src/services/push-state.mjs - 飞书推送状态与日志
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getCurrentAnchorName, atomicWriteJSON } from '../utils/monitor-utils.mjs';

export const LAST_PUSH_FILE = path.join(DATA_DIR, 'last-push.json');
export const PUSH_LOG_FILE = path.join(DATA_DIR, 'push-log.json');
export const PUSH_TYPES = { MAIN: '主力监控', BALANCE: '余额告警', BUDGET: '预算告警', DAILY: '日报', SUMMARY: '日结' };

export function loadLastPush() {
  try { if (fs.existsSync(LAST_PUSH_FILE)) return JSON.parse(fs.readFileSync(LAST_PUSH_FILE, 'utf-8')); } catch {}
  return { timestamp: 0, level: 0 };
}

export function saveLastPush(state) {
  atomicWriteJSON(LAST_PUSH_FILE, state);
}

export function appendPushLog(type, status, detail, analysis) {
  try {
    let log = { entries: [] };
    if (fs.existsSync(PUSH_LOG_FILE)) {
      try { log = JSON.parse(fs.readFileSync(PUSH_LOG_FILE, 'utf-8')); } catch {}
    }
    const now = new Date();
    const anchor = analysis.currentAnchor || getCurrentAnchorName() || '';
    const summary = analysis.summary || {};
    log.entries.push({
      time: now.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      type,
      anchor,
      status,
      detail,
      spend: summary.totalSpend || summary.totalSpending || 0,
      leads: summary.totalLeads || summary.totalConversions || 0,
    });
    if (log.entries.length > 50) log.entries = log.entries.slice(-50);
    atomicWriteJSON(PUSH_LOG_FILE, log);
  } catch (e) {
    console.warn(`  ⚠ 推送日志写入失败: ${e.message}`);
  }
}
