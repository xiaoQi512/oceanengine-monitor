// tests/snapshot-db.test.mjs - 快照 DB 模块测试
import assert from 'node:assert';
import { DB_PATH, queryPlanSnapshot, findSnapshotAroundDB } from '../src/services/snapshot-db.mjs';

assert.ok(DB_PATH.endsWith('oceanengine.db'));
assert.strictEqual(queryPlanSnapshot('', '2026-08-02T01:00:00Z'), null);
assert.strictEqual(findSnapshotAroundDB('2026-08-02T01:00:00Z', 1), null);

console.log('\n全部测试通过');
