// tests/http-snapshot.test.mjs - http 快照读取与 DB 查询模块测试
import assert from 'node:assert';
import { DB_PATH, parseSnapshotTime } from '../src/services/http-snapshot.mjs';

assert.ok(DB_PATH.endsWith('oceanengine.db'));
assert.strictEqual(parseSnapshotTime('2026-08-02T01:00:00').toISOString(), '2026-08-02T01:00:00.000Z');

console.log('\n全部测试通过');
