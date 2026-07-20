// tests/action-queue-lock.test.mjs
// 验证 action-queue-worker.mjs 的串行锁逻辑（核心: PID 存活检查 + 僵死锁接管）
//
// 用法: node tests/action-queue-lock.test.mjs
//
// 注意: 被测文件已将 LOCK_FILE 硬编码为项目根目录下的 action-queue.json.lock，
// 本测试用"备份→覆盖→恢复"模式直接操作该真实路径，结束后一定恢复。
// 跑测试时不应有其他 worker 在跑。

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const { isPidAlive, readLockInfo, acquireLock, releaseLock, LOCK_FILE, STALE_LOCK_TIMEOUT_MS } =
  await import('../action-queue-worker.mjs');

assert.strictEqual(LOCK_FILE, path.join(PROJECT_ROOT, 'action-queue.json.lock'),
  'LOCK_FILE 应指向项目根目录');

// 静默 console 输出（避免污染测试日志）
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
const backupPath = LOCK_FILE + '.test-bak';
function backupLock() {
  if (fs.existsSync(LOCK_FILE)) fs.renameSync(LOCK_FILE, backupPath);
}
function restoreLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
  if (fs.existsSync(backupPath)) fs.renameSync(backupPath, LOCK_FILE);
}
function writeLockPayload(p) {
  fs.writeFileSync(LOCK_FILE, typeof p === 'string' ? p : JSON.stringify(p));
  // 把 mtime 拨到指定毫秒前（用于模拟超时）
  if (p && p._mtimeAgoMs) {
    const t = (Date.now() - p._mtimeAgoMs) / 1000;
    fs.utimesSync(LOCK_FILE, t, t);
    delete p._mtimeAgoMs;
    fs.writeFileSync(LOCK_FILE, JSON.stringify(p));
  }
}
function readLockJson() {
  try { return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); }
  catch { return null; }
}
function existsLock() { return fs.existsSync(LOCK_FILE); }

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
  assert.strictEqual(isPidAlive(2_000_000_000), false);
});

// ============ 单元: readLockInfo ============

await test('readLockInfo: 解析标准 { pid, time } 格式', () => {
  backupLock();
  try {
    writeLockPayload({ pid: 12345, time: '2026-06-30T00:00:00.000Z' });
    const info = readLockInfo();
    assert.strictEqual(info.pid, 12345);
    assert.strictEqual(info.time, '2026-06-30T00:00:00.000Z');
  } finally { restoreLock(); }
});

await test('readLockInfo: 损坏 JSON 返回 pid=null', () => {
  backupLock();
  try {
    writeLockPayload('not json{{{');
    const info = readLockInfo();
    assert.strictEqual(info.pid, null);
    assert.strictEqual(info.time, null);
  } finally { restoreLock(); }
});

await test('readLockInfo: 缺 pid 字段返回 pid=null', () => {
  backupLock();
  try {
    writeLockPayload({ time: '2026-06-30T00:00:00.000Z' });
    const info = readLockInfo();
    assert.strictEqual(info.pid, null);
  } finally { restoreLock(); }
});

await test('readLockInfo: 文件不存在返回全 null', () => {
  backupLock();
  try {
    const info = readLockInfo();
    assert.strictEqual(info.pid, null);
    assert.strictEqual(info.raw, null);
  } finally { restoreLock(); }
});

// ============ 集成: acquireLock ============

await test('acquireLock: 死 PID 锁应立即被接管（不需等 10 分钟）', () => {
  backupLock();
  try {
    // 写一个必死的 PID
    writeLockPayload({ pid: 2_000_000_000, time: new Date().toISOString() });
    const t0 = Date.now();
    const ok = acquireLock();
    const elapsed = Date.now() - t0;
    assert.strictEqual(ok, true, '应成功接管死锁');
    assert.ok(elapsed < 1000, `接管应 < 1s，实际 ${elapsed}ms`);
    const cur = readLockJson();
    assert.strictEqual(cur.pid, process.pid, '锁的 PID 应已覆盖为当前进程');
  } finally { restoreLock(); }
});

await test('acquireLock: 仍存活的 PID 持有锁应被拒绝', () => {
  backupLock();
  try {
    writeLockPayload({ pid: process.pid, time: new Date().toISOString() });
    const ok = acquireLock();
    assert.strictEqual(ok, false, '活锁应被拒绝');
    // 锁内容应原样保留（仍是原 PID）
    const cur = readLockJson();
    assert.strictEqual(cur.pid, process.pid, '原 PID 应未变');
  } finally { restoreLock(); }
});

await test('acquireLock: 活 PID 但锁超时 → 强制接管', () => {
  backupLock();
  try {
    // 写一个活 PID（自身），但 mtime 拨到 11 分钟前
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }));
    const oldTime = (Date.now() - 11 * 60 * 1000) / 1000;
    fs.utimesSync(LOCK_FILE, oldTime, oldTime);
    const ok = acquireLock();
    assert.strictEqual(ok, true, '超时活锁应被强制接管');
    const cur = readLockJson();
    // PID 内容是 process.pid 仍然（因为我们用自身测），但 time 字段应被刷新
    const ageMs = Date.now() - new Date(cur.time).getTime();
    assert.ok(ageMs < 5000, 'time 字段应被刷新为当前时间');
  } finally { restoreLock(); }
});

await test('acquireLock: 旧格式锁（无 pid 字段）应立即接管（无法确认持有者 = 无主）', () => {
  backupLock();
  try {
    // 没 pid 字段 → 无法证明持有者活着 → 立即接管（P0-6 修复点）
    writeLockPayload({ time: new Date().toISOString() });
    const ok = acquireLock();
    assert.strictEqual(ok, true, '无 PID 字段锁应被立即接管');
    const cur = readLockJson();
    assert.strictEqual(cur.pid, process.pid);
  } finally { restoreLock(); }
});

await test('acquireLock: 旧格式锁（无 pid 字段）即使未超时也应接管', () => {
  backupLock();
  try {
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ time: new Date().toISOString() }));
    // 注意：未拨 mtime，刚写的锁，age ≈ 0
    const ok = acquireLock();
    assert.strictEqual(ok, true, '无 PID 锁无论是否超时都应被接管');
    const cur = readLockJson();
    assert.strictEqual(cur.pid, process.pid);
  } finally { restoreLock(); }
});

await test('acquireLock: 损坏 JSON 锁应被接管', () => {
  backupLock();
  try {
    writeLockPayload('not valid json at all');
    const ok = acquireLock();
    assert.strictEqual(ok, true, '损坏 JSON 锁应被接管');
    const cur = readLockJson();
    assert.strictEqual(cur.pid, process.pid);
  } finally { restoreLock(); }
});

await test('acquireLock: 锁不存在时应成功创建', () => {
  backupLock();
  try {
    assert.strictEqual(existsLock(), false);
    const ok = acquireLock();
    assert.strictEqual(ok, true);
    const cur = readLockJson();
    assert.strictEqual(cur.pid, process.pid);
    assert.ok(typeof cur.time === 'string');
  } finally { restoreLock(); }
});

await test('acquireLock: releaseLock 后能再次获取', () => {
  backupLock();
  try {
    const ok1 = acquireLock();
    assert.strictEqual(ok1, true);
    releaseLock();
    assert.strictEqual(existsLock(), false);
    const ok2 = acquireLock();
    assert.strictEqual(ok2, true);
  } finally { restoreLock(); }
});

// ============ 常量 ============

await test('常量: STALE_LOCK_TIMEOUT_MS 应为 10 分钟', () => {
  assert.strictEqual(STALE_LOCK_TIMEOUT_MS, 10 * 60 * 1000);
});

// ============ 清理 ============
restoreLock();

// ============ 总结 ============
origLog(`\n📊 测试结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
