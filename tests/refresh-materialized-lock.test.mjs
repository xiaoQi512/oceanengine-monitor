// tests/refresh-materialized-lock.test.mjs
// T1-Q5 P0-4: 验证 db/refresh-materialized.mjs 的并发窗口锁逻辑
// 覆盖场景:
//   - isPidAlive: 合法/非法 PID、当前进程、大 PID
//   - readRefreshLockInfo: 标准/损坏/缺字段/不存在
//   - acquireRefreshLock: 死 PID / 活 PID / 超时活锁 / 缺 pid / 损坏 JSON / 无锁
//   - releaseRefreshLock
//   - refreshMaterialized: 锁被占时跳过 + DB 不被修改
//   - 常量: REFRESH_LOCK_FILE / STALE_REFRESH_TIMEOUT_MS
//
// 用法: node tests/refresh-materialized-lock.test.mjs
// 注意: 直接操作 monitor-data/refresh-materialized.lock，测试结束一定恢复

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const {
  isPidAlive,
  readRefreshLockInfo,
  acquireRefreshLock,
  releaseRefreshLock,
  refreshMaterialized,
  REFRESH_LOCK_FILE,
  STALE_REFRESH_TIMEOUT_MS,
} = await import('../db/refresh-materialized.mjs');

// 静默 console 输出
const origLog = console.log, origWarn = console.warn, origErr = console.error;
function silence() {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}
function restore() {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origErr;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  silence();
  try {
    await fn();
    passed++;
    restore();
    origLog(`✅ ${name}`);
  } catch (e) {
    failed++;
    restore();
    origErr(`❌ ${name}\n   ${e.message}`);
  }
}

// 备份/恢复原 LOCK_FILE
const backupPath = REFRESH_LOCK_FILE + '.test-bak';
function backupLock() {
  if (fs.existsSync(REFRESH_LOCK_FILE)) fs.renameSync(REFRESH_LOCK_FILE, backupPath);
}
function restoreLock() {
  try { fs.unlinkSync(REFRESH_LOCK_FILE); } catch {}
  if (fs.existsSync(backupPath)) fs.renameSync(backupPath, REFRESH_LOCK_FILE);
}
function writeLockPayload(p) {
  fs.writeFileSync(REFRESH_LOCK_FILE, typeof p === 'string' ? p : JSON.stringify(p));
  // 把 mtime 拨到指定毫秒前（用于模拟超时）
  if (p && typeof p === 'object' && p._mtimeAgoMs) {
    const t = (Date.now() - p._mtimeAgoMs) / 1000;
    fs.utimesSync(REFRESH_LOCK_FILE, t, t);
    delete p._mtimeAgoMs;
    fs.writeFileSync(REFRESH_LOCK_FILE, JSON.stringify(p));
  }
}
function readLockJson() {
  try { return JSON.parse(fs.readFileSync(REFRESH_LOCK_FILE, 'utf8')); }
  catch { return null; }
}
function existsLock() { return fs.existsSync(REFRESH_LOCK_FILE); }

// ============ 单元: isPidAlive ============

await test('isPidAlive: 当前进程 PID 应返回 true', () => {
  assert.strictEqual(isPidAlive(process.pid), true);
});

await test('isPidAlive: 非法 PID 应返回 false', () => {
  assert.strictEqual(isPidAlive(0), false);
  assert.strictEqual(isPidAlive(-1), false);
  assert.strictEqual(isPidAlive(1.5), false);
  assert.strictEqual(isPidAlive('123'), false);
  assert.strictEqual(isPidAlive(null), false);
  assert.strictEqual(isPidAlive(undefined), false);
});

await test('isPidAlive: 不存在的大 PID 应返回 false', () => {
  // 2e9 远超 Windows PID 实际范围 (通常 < 100000)
  assert.strictEqual(isPidAlive(2_000_000_000), false);
});

// ============ 单元: readRefreshLockInfo ============

await test('readRefreshLockInfo: 解析标准 { pid, time } 格式', () => {
  backupLock();
  try {
    writeLockPayload({ pid: 12345, time: '2026-06-30T00:00:00.000Z' });
    const info = readRefreshLockInfo();
    assert.strictEqual(info.pid, 12345);
    assert.strictEqual(info.time, '2026-06-30T00:00:00.000Z');
  } finally { restoreLock(); }
});

await test('readRefreshLockInfo: 损坏 JSON 返回 pid=null', () => {
  backupLock();
  try {
    writeLockPayload('not json{{{');
    const info = readRefreshLockInfo();
    assert.strictEqual(info.pid, null);
    assert.strictEqual(info.time, null);
  } finally { restoreLock(); }
});

await test('readRefreshLockInfo: 缺 pid 字段返回 pid=null', () => {
  backupLock();
  try {
    writeLockPayload({ time: '2026-06-30T00:00:00.000Z' });
    const info = readRefreshLockInfo();
    assert.strictEqual(info.pid, null);
  } finally { restoreLock(); }
});

await test('readRefreshLockInfo: pid 非整数（字符串）应规范为 null', () => {
  backupLock();
  try {
    writeLockPayload({ pid: '12345', time: '2026-06-30T00:00:00.000Z' });
    const info = readRefreshLockInfo();
    assert.strictEqual(info.pid, null, '字符串 pid 应视为无效');
  } finally { restoreLock(); }
});

await test('readRefreshLockInfo: 文件不存在返回全 null', () => {
  backupLock();
  try {
    const info = readRefreshLockInfo();
    assert.strictEqual(info.pid, null);
    assert.strictEqual(info.time, null);
    assert.strictEqual(info.raw, null);
  } finally { restoreLock(); }
});

// ============ 集成: acquireRefreshLock ============

await test('acquireRefreshLock: 死 PID 锁应立即被接管（不需等 5 分钟）', () => {
  backupLock();
  try {
    writeLockPayload({ pid: 2_000_000_000, time: new Date().toISOString() });
    const t0 = Date.now();
    const ok = acquireRefreshLock();
    const elapsed = Date.now() - t0;
    assert.strictEqual(ok, true, '应成功接管死锁');
    assert.ok(elapsed < 1000, `接管应 < 1s，实际 ${elapsed}ms`);
    const cur = readLockJson();
    assert.strictEqual(cur.pid, process.pid, '锁的 PID 应已覆盖为当前进程');
    assert.strictEqual(cur.forced, true, '应标记 forced=true');
    assert.strictEqual(cur.prevPid, 2_000_000_000, '应记录原 PID');
  } finally { restoreLock(); }
});

await test('acquireRefreshLock: 仍存活的 PID 持有锁应被拒绝', () => {
  backupLock();
  try {
    writeLockPayload({ pid: process.pid, time: new Date().toISOString() });
    const ok = acquireRefreshLock();
    assert.strictEqual(ok, false, '活锁应被拒绝');
    const cur = readLockJson();
    assert.strictEqual(cur.pid, process.pid, '原 PID 应未变');
    // 关键: 没有 forced 字段 → 拒绝时不应修改锁
    assert.strictEqual(cur.forced, undefined);
  } finally { restoreLock(); }
});

await test('acquireRefreshLock: 活 PID 但锁超时（>5min）→ 强制接管', () => {
  backupLock();
  try {
    fs.writeFileSync(REFRESH_LOCK_FILE, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }));
    const oldTime = (Date.now() - 6 * 60 * 1000) / 1000; // 6 分钟前
    fs.utimesSync(REFRESH_LOCK_FILE, oldTime, oldTime);
    const ok = acquireRefreshLock();
    assert.strictEqual(ok, true, '超时活锁应被强制接管');
    const cur = readLockJson();
    assert.strictEqual(cur.forced, true, '应标记 forced=true');
    // time 字段应被刷新为当前时间（年龄 < 5s）
    const ageMs = Date.now() - new Date(cur.time).getTime();
    assert.ok(ageMs < 5000, `time 字段应被刷新，实际年龄 ${ageMs}ms`);
  } finally { restoreLock(); }
});

await test('acquireRefreshLock: 旧格式锁（无 pid 字段）应立即接管', () => {
  backupLock();
  try {
    writeLockPayload({ time: new Date().toISOString() });
    const ok = acquireRefreshLock();
    assert.strictEqual(ok, true, '无 PID 字段锁应被立即接管');
    const cur = readLockJson();
    assert.strictEqual(cur.pid, process.pid);
    assert.strictEqual(cur.forced, true);
  } finally { restoreLock(); }
});

await test('acquireRefreshLock: 损坏 JSON 锁应被接管', () => {
  backupLock();
  try {
    writeLockPayload('not valid json at all');
    const ok = acquireRefreshLock();
    assert.strictEqual(ok, true, '损坏 JSON 锁应被接管');
    const cur = readLockJson();
    assert.strictEqual(cur.pid, process.pid);
  } finally { restoreLock(); }
});

await test('acquireRefreshLock: 锁不存在时应成功创建', () => {
  backupLock();
  try {
    assert.strictEqual(existsLock(), false);
    const ok = acquireRefreshLock();
    assert.strictEqual(ok, true);
    const cur = readLockJson();
    assert.strictEqual(cur.pid, process.pid);
    assert.ok(typeof cur.time === 'string');
  } finally { restoreLock(); }
});

await test('acquireRefreshLock: releaseRefreshLock 后能再次获取', () => {
  backupLock();
  try {
    const ok1 = acquireRefreshLock();
    assert.strictEqual(ok1, true);
    releaseRefreshLock();
    assert.strictEqual(existsLock(), false);
    const ok2 = acquireRefreshLock();
    assert.strictEqual(ok2, true);
  } finally { restoreLock(); }
});

// ============ 集成: refreshMaterialized + 锁 ============

await test('refreshMaterialized: 锁被占时返回 ok:false, error=locked', () => {
  backupLock();
  try {
    // 模拟另一进程持有锁
    writeLockPayload({ pid: process.pid, time: new Date().toISOString() });
    const r = refreshMaterialized();
    assert.strictEqual(r.ok, false, '应返回失败');
    assert.strictEqual(r.error, 'locked', 'error 应为 locked');
    assert.strictEqual(r.skipped, true, '应标记 skipped=true');
    assert.ok(r.lockedBy, '应包含 lockedBy 信息');
    assert.strictEqual(r.lockedBy.pid, process.pid);
  } finally { restoreLock(); }
});

await test('refreshMaterialized: 锁被占时不应修改 last_materialized_refresh', async () => {
  // 此测试需要真实 DB — 跳过若 DB 不存在
  const dbPath = path.join(PROJECT_ROOT, 'monitor-data', 'oceanengine.db');
  if (!fs.existsSync(dbPath)) {
    origLog('   ⏭ 跳过: oceanengine.db 不存在');
    return;
  }
  backupLock();
  try {
    // 先获取当前 checkpoint
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });
    const before = db.prepare(`SELECT value FROM config WHERE key='last_materialized_refresh'`).get();
    db.close();

    // 模拟另一进程持有锁
    writeLockPayload({ pid: process.pid, time: new Date().toISOString() });
    const r = refreshMaterialized();
    assert.strictEqual(r.ok, false, '应被锁拒绝');

    // 再次读取 checkpoint
    const db2 = new Database(dbPath, { readonly: true });
    const after = db2.prepare(`SELECT value FROM config WHERE key='last_materialized_refresh'`).get();
    db2.close();
    assert.strictEqual(after?.value, before?.value, 'checkpoint 不应被修改');
  } finally { restoreLock(); }
});

await test('refreshMaterialized: 锁释放后能正常刷新', () => {
  const dbPath = path.join(PROJECT_ROOT, 'monitor-data', 'oceanengine.db');
  if (!fs.existsSync(dbPath)) {
    origLog('   ⏭ 跳过: oceanengine.db 不存在');
    return;
  }
  backupLock();
  try {
    // 不预占锁 — 应能正常跑
    const r = refreshMaterialized();
    // 不校验具体数值（依赖 snapshots 表数据），只校验: 不被锁拒绝
    assert.strictEqual(r.error, undefined, `不应返回 error，实际: ${r.error}`);
    // 最后锁应被释放
    assert.strictEqual(existsLock(), false, '完成后应释放锁');
  } finally { restoreLock(); }
});

await test('refreshMaterialized: 同进程并发第二次调用应被锁拒绝', () => {
  const dbPath = path.join(PROJECT_ROOT, 'monitor-data', 'oceanengine.db');
  if (!fs.existsSync(dbPath)) {
    origLog('   ⏭ 跳过: oceanengine.db 不存在');
    return;
  }
  backupLock();
  try {
    // 第一次: 模拟"另一进程"持锁中
    writeLockPayload({ pid: process.pid + 9999, time: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    // 写一个已死 PID（不存活）让 acquireRefreshLock 接管
    fs.utimesSync(REFRESH_LOCK_FILE, (Date.now() - 10 * 60 * 1000) / 1000, (Date.now() - 10 * 60 * 1000) / 1000);
    // 现在锁 PID=9999, mtime=-10min, isPidAlive(9999)=false → 应被接管
    // 先手动模拟 "持有中" 状态: 用 process.pid 写一个活锁
    writeLockPayload({ pid: process.pid, time: new Date().toISOString() });
    const r = refreshMaterialized();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'locked');
  } finally { restoreLock(); }
});

// ============ 常量 ============

await test('常量: REFRESH_LOCK_FILE 应在 monitor-data/ 下', () => {
  assert.strictEqual(REFRESH_LOCK_FILE, path.join(PROJECT_ROOT, 'monitor-data', 'refresh-materialized.lock'));
});

await test('常量: STALE_REFRESH_TIMEOUT_MS 应为 5 分钟', () => {
  assert.strictEqual(STALE_REFRESH_TIMEOUT_MS, 5 * 60 * 1000);
});

// ============ 清理 ============
restoreLock();

// ============ 总结 ============
origLog(`\n📊 测试结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
