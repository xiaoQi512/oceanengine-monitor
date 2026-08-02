// scripts/check-imports.mjs - src/ 分层 import 检查
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(PROJECT_ROOT, 'src');

const LAYERS = ['platform', 'domain', 'services', 'db', 'feishu', 'cdp', 'utils', 'config'];
const ALLOWED_TARGETS = {
  platform: new Set(['platform', 'utils', 'config']),
  domain: new Set(['domain']),
};

function walk(dir, base, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.name.endsWith('.mjs')) out.push(rel);
  }
  return out;
}

function targetLayerFor(spec, file) {
  if (spec.startsWith('src/')) {
    return spec.slice('src/'.length).split('/')[0];
  }
  const resolved = path.resolve(path.dirname(path.join(SRC_ROOT, file)), spec).replace(/\\/g, '/');
  const marker = resolved.indexOf('/src/');
  if (marker < 0) return null;
  return resolved.slice(marker + '/src/'.length).split('/')[0];
}

const violations = [];
for (const file of walk(SRC_ROOT, SRC_ROOT)) {
  const sourceLayer = file.split('/')[0];
  const allowed = ALLOWED_TARGETS[sourceLayer];
  if (!allowed) continue;

  const source = fs.readFileSync(path.join(SRC_ROOT, file), 'utf8');
  const importRe = /(?:from|import\()\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRe.exec(source))) {
    const spec = match[1];
    if (spec.startsWith('node:') || !spec.startsWith('.')) continue;
    const target = targetLayerFor(spec, file);
    if (target && LAYERS.includes(target) && !allowed.has(target)) {
      violations.push(`${file} -> ${spec} [${sourceLayer} -> ${target}]`);
    }
  }
}

if (violations.length > 0) {
  console.error(`❌ 分层 import 检查失败: ${violations.length} 处`);
  for (const line of violations) console.error('  ' + line);
  process.exit(1);
}

console.log('分层 import 检查通过');
