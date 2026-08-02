// scripts/check-root-entries.mjs - 根目录兼容入口一致性检查
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_ENTRY_BYTES = 2048;
const allowedUtilities = new Set(['send-chat.mjs']);

const entries = fs.readdirSync(ROOT)
  .filter(name => name.endsWith('.mjs'))
  .sort();

assert.ok(entries.length > 0, '根目录应存在兼容入口');
for (const name of entries) {
  const file = path.join(ROOT, name);
  const size = fs.statSync(file).size;
  assert.ok(size <= MAX_ENTRY_BYTES, `${name} 根入口过大 (${size} bytes)`);
  if (allowedUtilities.has(name)) continue;
  const text = fs.readFileSync(file, 'utf-8');
  const pointsToSrc = /(?:from\s+['"]|import\s*\(\s*['"]|import\s+['"])\.\/(?:src|db)\//.test(text);
  assert.ok(pointsToSrc, `${name} 未指向 src/db 兼容模块`);
}

console.log(`\n全部测试通过 (${entries.length} 个根目录入口均为兼容/薄入口)`);
