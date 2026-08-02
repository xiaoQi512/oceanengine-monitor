// src/services/live-watcher-state.mjs - live-watcher 状态文件
import fs from 'node:fs';

export function loadState(stateFile, fsImpl = fs) {
  try {
    if (fsImpl.existsSync(stateFile)) return JSON.parse(fsImpl.readFileSync(stateFile, 'utf-8'));
  } catch {}
  return { wasLive: false, lastChangeTime: null, todayDate: '' };
}

export function saveState(state, stateFile, fsImpl = fs) {
  try { fsImpl.writeFileSync(stateFile, JSON.stringify(state, null, 2)); } catch {}
}

export function todayStr(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function timeStr(d = new Date()) {
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}
