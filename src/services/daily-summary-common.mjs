// src/services/daily-summary-common.mjs - 大号日汇总公共工具
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getShiftsPerDay } from '../utils/monitor-utils.mjs';
import { normalizeShiftLabel } from '../domain/shift-schedule.mjs';

export function log(...args) {
  console.log(`[daily-summary] ${new Date().toLocaleString()} |`, ...args);
}

export function todayDateCN() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function getTodayDateStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function getSessionsForDate(dateStr, { dataDir = DATA_DIR, fsImpl = fs, pathImpl = path } = {}) {
  try {
    const cacheFile = pathImpl.join(dataDir, `shifts-${dateStr}.json`);
    if (fsImpl.existsSync(cacheFile)) {
      const cached = JSON.parse(fsImpl.readFileSync(cacheFile, 'utf-8'));
      if (Array.isArray(cached.shifts) && cached.shifts.length > 0) {
        return cached.shifts.map(s => {
          const m = normalizeShiftLabel(s.label).match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
          if (m) return {
            start: m[1].padStart(2, '0') + ':' + m[2],
            end: m[3].padStart(2, '0') + ':' + m[4],
            anchorName: s.anchorName || '',
          };
          return null;
        }).filter(Boolean);
      }
    }
  } catch {}
  return [
    { start: '06:30', end: '08:30', anchorName: '' },
    { start: '08:30', end: '10:30', anchorName: '' },
    { start: '10:30', end: '12:30', anchorName: '' },
    { start: '12:30', end: '14:30', anchorName: '' },
    { start: '14:30', end: '16:30', anchorName: '' },
    { start: '16:30', end: '18:30', anchorName: '' },
    { start: '18:30', end: '20:30', anchorName: '' },
    { start: '20:30', end: '22:30', anchorName: '' },
    { start: '22:30', end: '23:30', anchorName: '' },
  ];
}

const BASE_DATE = new Date(2026, 5, 26);
const BASE_ROW = 200;

export function getTodayStartRow({ getShiftsPerDayFn = getShiftsPerDay } = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let row = BASE_ROW;
  const d = new Date(BASE_DATE);
  while (d < today) {
    const dateStr = d.toISOString().slice(0, 10);
    row += getShiftsPerDayFn(dateStr);
    d.setDate(d.getDate() + 1);
  }
  return row;
}
