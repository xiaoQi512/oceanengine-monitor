// tests/progress-bar.test.mjs - 文本进度条测试
import assert from 'node:assert';
import { makeBar } from '../src/domain/progress-bar.mjs';

assert.strictEqual(makeBar(0), '░'.repeat(10));
assert.strictEqual(makeBar(100), '█'.repeat(10));
assert.ok(makeBar(50).includes('█'));
assert.strictEqual(makeBar(200, 10).length, 10);

console.log('\n全部测试通过');
