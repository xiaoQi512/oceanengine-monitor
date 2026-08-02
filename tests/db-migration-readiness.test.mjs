// tests/db-migration-readiness.test.mjs - v2 schema 就绪检查测试
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { checkV2Schema } from '../src/db/migration-readiness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.resolve(__dirname, '../src/db/v2/schema.sql'), 'utf8');
const db = new Database(':memory:');
db.exec(schema);

const result = checkV2Schema(db);
assert.strictEqual(result.ok, true, JSON.stringify(result));
assert.strictEqual(result.schemaVersion, '2.0');
assert.deepStrictEqual(result.missingTables, []);
assert.deepStrictEqual(result.missingSnapshotCols, []);

db.close();
console.log('\n全部测试通过');
