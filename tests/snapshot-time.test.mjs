// tests/snapshot-time.test.mjs - 快照时间解析与查找测试
import assert from 'node:assert';
import {
  parseSnapshotTime,
  parseSnapFileName,
  buildSnapFileIndex,
  findClosestSnapshotEntry,
} from '../src/domain/snapshot-time.mjs';

assert.strictEqual(parseSnapshotTime('2026-08-02T01:00:00').toISOString(), '2026-08-02T01:00:00.000Z');
assert.strictEqual(parseSnapshotTime(null).getTime(), NaN);
const entry = parseSnapFileName('5m-2026-08-02T01-00-00.json');
assert.strictEqual(entry.isoLike, '2026-08-02T01:00:00');
assert.strictEqual(parseSnapFileName('bad.json'), null);
const index = buildSnapFileIndex(['5m-2026-08-02T01-00-00.json', '5m-2026-08-02T01-10-00.json']);
const closest = findClosestSnapshotEntry(index, '2026-08-02T01:04:00', 6 * 60 * 1000);
assert.strictEqual(closest.file, '5m-2026-08-02T01-00-00.json');

console.log('\n全部测试通过');
