// src/db/dual-write.mjs - 旧 writer 与 v2 compat 写入切换/并行灰度
// 默认 v2 主写：设置 DB_V2_PRIMARY=0 可回退旧 writer；DB_V2_DUAL_WRITE=1 时同步旧 writer 用于对比。
import {
  insertSnapshot as legacyInsertSnapshot,
  insertAction as legacyInsertAction,
} from './writer.mjs';
import * as v2Compat from './v2/compat-writer.mjs';

function dualWriteEnabled() {
  return process.env.DB_V2_DUAL_WRITE === '1';
}

export function v2PrimaryEnabled() {
  return process.env.DB_V2_PRIMARY !== '0';
}

export function dualInsertSnapshot(data, snapshotTime) {
  const primary = v2PrimaryEnabled();
  const dualWrite = { enabled: dualWriteEnabled(), primary };
  let result;
  if (primary) {
    try {
      result = v2Compat.insertSnapshot(data, snapshotTime);
      dualWrite.v2Ok = true;
    } catch (e) {
      dualWrite.v2Error = e.message;
      result = legacyInsertSnapshot(data, snapshotTime);
      dualWrite.fallbackToLegacy = true;
      console.warn('[dual-write] v2 snapshot 主写失败:', e.message);
    }
    if (dualWrite.enabled && dualWrite.v2Ok && result.ok) {
      const legacyResult = legacyInsertSnapshot(data, snapshotTime);
      dualWrite.legacyOk = legacyResult.ok;
      if (!legacyResult.ok) dualWrite.legacyError = legacyResult.error;
    }
  } else {
    result = legacyInsertSnapshot(data, snapshotTime);
    if (dualWrite.enabled && result.ok) {
      try {
        v2Compat.insertSnapshot(data, snapshotTime);
        dualWrite.v2Ok = true;
      } catch (e) {
        dualWrite.v2Ok = false;
        dualWrite.error = e.message;
        console.warn('[dual-write] v2 snapshot 写入失败:', e.message);
      }
    }
  }
  return { ...result, dualWrite };
}

export function dualInsertAction(entry) {
  const primary = v2PrimaryEnabled();
  const dualWrite = { enabled: dualWriteEnabled(), primary };
  let result;
  if (primary) {
    try {
      result = v2Compat.insertAction(entry);
      dualWrite.v2Ok = true;
    } catch (e) {
      dualWrite.v2Error = e.message;
      result = legacyInsertAction(entry);
      dualWrite.fallbackToLegacy = true;
      console.warn('[dual-write] v2 action 主写失败:', e.message);
    }
    if (dualWrite.enabled && dualWrite.v2Ok && result.ok) {
      const legacyResult = legacyInsertAction(entry);
      dualWrite.legacyOk = legacyResult.ok;
      if (!legacyResult.ok) dualWrite.legacyError = legacyResult.error;
    }
  } else {
    result = legacyInsertAction(entry);
    if (dualWrite.enabled && result.ok) {
      try {
        v2Compat.insertAction(entry);
        dualWrite.v2Ok = true;
      } catch (e) {
        dualWrite.v2Ok = false;
        dualWrite.error = e.message;
        console.warn('[dual-write] v2 action 写入失败:', e.message);
      }
    }
  }
  return { ...result, dualWrite };
}
