// src/services/five-min-push-state.mjs - 5min last-push 状态
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../utils/monitor-utils.mjs';
import { shouldPush5min } from '../domain/five-minute-logic.mjs';

export function pushStateFile(dataDir = DATA_DIR) {
  return path.join(dataDir, 'last-5m-push.json');
}

export function loadLastPushState({ dataDir = DATA_DIR, file = pushStateFile(dataDir) } = {}) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {}
  return {};
}

export function saveLastPushState({
  dataDir = DATA_DIR,
  file = pushStateFile(dataDir),
  timestamp = Date.now(),
} = {}) {
  try {
    fs.writeFileSync(file, JSON.stringify({ timestamp }), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function shouldPushFiveMin({
  lastPush = {},
  now = Date.now(),
  minIntervalMs = 60_000,
} = {}) {
  return shouldPush5min(lastPush, now, minIntervalMs);
}
