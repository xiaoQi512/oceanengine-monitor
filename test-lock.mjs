// Quick test for action-queue-worker lock logic
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = __dirname;

const { isPidAlive, readLockInfo, acquireLock, releaseLock, LOCK_FILE, STALE_LOCK_TIMEOUT_MS } =
  await import('./action-queue-worker.mjs');

console.log('LOCK_FILE:', LOCK_FILE);
console.log('STALE_LOCK_TIMEOUT_MS:', STALE_LOCK_TIMEOUT_MS);

// ============ Quick isPidAlive tests ============
console.log('\n--- isPidAlive ---');
console.log('process.pid:', isPidAlive(process.pid));      // true
console.log('0:', isPidAlive(0));                          // false
console.log('-1:', isPidAlive(-1));                        // false
console.log('1.5:', isPidAlive(1.5));                      // false
console.log('"123":', isPidAlive('123'));                  // false
console.log('null:', isPidAlive(null));                    // false
console.log('undefined:', isPidAlive(undefined));          // false
console.log('2e9:', isPidAlive(2_000_000_000));            // false

// ============ Quick readLockInfo tests ============
console.log('\n--- readLockInfo (no lock file) ---');
const info = readLockInfo();
console.log('pid:', info.pid, 'raw:', info.raw);

// ============ Quick acquireLock tests ============
console.log('\n--- acquireLock (no lock) ---');
const ok1 = acquireLock();
console.log('ok:', ok1);
if (ok1) {
  const cur = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  console.log('lock pid:', cur.pid, '=== process.pid:', cur.pid === process.pid);
  releaseLock();
  console.log('lock file exists after release:', fs.existsSync(LOCK_FILE));
}

// ============ Dead PID takeover ============
console.log('\n--- Dead PID takeover ---');
fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: 2_000_000_000, time: new Date().toISOString() }));
const ok2 = acquireLock();
console.log('ok:', ok2);
const cur2 = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
console.log('lock pid matches process.pid:', cur2.pid === process.pid);
releaseLock();

// ============ No PID takeover (P0-6) ============
console.log('\n--- No PID takeover (P0-6) ---');
fs.writeFileSync(LOCK_FILE, JSON.stringify({ time: new Date().toISOString() }));
const ok3 = acquireLock();
console.log('ok:', ok3);
const cur3 = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
console.log('lock pid matches process.pid:', cur3.pid === process.pid);
releaseLock();

// ============ Damaged JSON takeover ============
console.log('\n--- Damaged JSON takeover ---');
fs.writeFileSync(LOCK_FILE, 'not valid json');
const ok4 = acquireLock();
console.log('ok:', ok4);
const cur4 = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
console.log('lock pid matches process.pid:', cur4.pid === process.pid);
releaseLock();

// ============ Alive PID refusal ============
console.log('\n--- Alive PID refusal ---');
fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }));
const ok5 = acquireLock();
console.log('ok:', ok5, '(should be false)');
const cur5 = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
console.log('lock pid unchanged:', cur5.pid === process.pid);
releaseLock();

console.log('\n✅ All quick tests completed');
