// scripts/check-refactor-status.mjs - 重构进度与关键约束检查
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_SERVICE_BYTES = 20_000;

function lineCount(relative) {
  const file = path.join(ROOT, relative);
  return fs.readFileSync(file, 'utf-8').split(/\r?\n/).length;
}

assert.ok(lineCount('src/services/monitor-15min.mjs') <= 60, 'monitor-15min 入口应保持薄壳');
assert.ok(lineCount('src/services/monitor-5min.mjs') <= 60, 'monitor-5min 入口应保持薄壳');

const requiredModules = [
  'src/services/monitor-cycle.mjs',
  'src/services/five-min-cycle.mjs',
  'src/services/monitor-cli.mjs',
  'src/services/monitor-io.mjs',
  'src/services/monitor-collect.mjs',
  'src/services/five-min-collect.mjs',
  'src/services/five-min-snapshot.mjs',
  'src/services/five-min-push.mjs',
  'src/services/five-min-detailed-push.mjs',
  'src/services/five-min-push-state.mjs',
];
for (const mod of requiredModules) {
  assert.ok(fs.existsSync(path.join(ROOT, mod)), `缺少重构模块: ${mod}`);
}

const rootEntries = fs.readdirSync(ROOT).filter(name => name.endsWith('.mjs')).length;
const serviceFiles = fs.readdirSync(path.join(ROOT, 'src', 'services')).filter(name => name.endsWith('.mjs')).length;
const domainFiles = fs.readdirSync(path.join(ROOT, 'src', 'domain')).filter(name => name.endsWith('.mjs')).length;
const testFiles = fs.readdirSync(path.join(ROOT, 'tests')).filter(name => name.endsWith('.mjs')).length;

const serviceNames = fs.readdirSync(path.join(ROOT, 'src', 'services')).filter(name => name.endsWith('.mjs'));
const maxEntryLines = 120;
const oversizedEntries = [];
for (const name of serviceNames) {
  const text = fs.readFileSync(path.join(ROOT, 'src', 'services', name), 'utf-8');
  if (/export\s+(async\s+)?function\s+runCli/.test(text)) {
    const lines = text.split(/\r?\n/).length;
    if (lines > maxEntryLines) oversizedEntries.push(`${name}(${lines})`);
  }
}
assert.deepStrictEqual(oversizedEntries, [], `runCli 入口超过 ${maxEntryLines} 行: ${oversizedEntries.join(', ')}`);

const oversizedServices = serviceNames.filter(name => {
  const size = fs.statSync(path.join(ROOT, 'src', 'services', name)).size;
  return size > MAX_SERVICE_BYTES;
});
assert.deepStrictEqual(oversizedServices, [], `服务文件超过 ${MAX_SERVICE_BYTES} bytes: ${oversizedServices.join(', ')}`);

console.log(`重构进度: 根入口 ${rootEntries} | services ${serviceFiles} | domain ${domainFiles} | tests ${testFiles}`);
console.log(`关键约束: monitor-15min/5min 薄入口、核心模块齐全、服务单文件 <= ${MAX_SERVICE_BYTES} bytes、runCli <= ${maxEntryLines} 行`);
console.log('\n全部测试通过');
