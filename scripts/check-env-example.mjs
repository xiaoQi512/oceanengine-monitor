// scripts/check-env-example.mjs - 环境变量示例一致性检查
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf-8');
const documented = new Set(
  [...example.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map(m => m[1]),
);
const allowlist = new Set([
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'NODE_EXE',
  'AGENT',
  'PATH',
  'COMSPEC',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
]);

const used = new Set();
function scanDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full);
      continue;
    }
    if (!/\.(mjs|js)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, 'utf-8');
    for (const m of text.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
      used.add(m[1]);
    }
  }
}

scanDir(path.join(ROOT, 'src'));
scanDir(path.join(ROOT, 'scripts'));

const missing = [...used]
  .filter(key => !allowlist.has(key) && !documented.has(key))
  .sort();
assert.deepStrictEqual(missing, [], `未在 .env.example 记录: ${missing.join(', ')}`);

console.log(`\n全部测试通过 (${documented.size} 个示例变量, ${used.size} 个代码引用)`);
