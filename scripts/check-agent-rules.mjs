// scripts/check-agent-rules.mjs - 校验常见 agent 自动规则文件
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const presenceOnly = ['AGENTS.md'];
const pointerRequired = [
  'CODEBUDDY.md',
  'CLAUDE.md',
  '.cursor/rules/project-rules.mdc',
  '.github/copilot-instructions.md',
];

for (const rel of [...presenceOnly, ...pointerRequired]) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.error(`[check-agent-rules] 缺少规则文件: ${rel}`);
    process.exit(1);
  }
}

for (const rel of pointerRequired) {
  const file = path.join(ROOT, rel);
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('AGENTS.md')) {
    console.error(`[check-agent-rules] ${rel} 未指向 AGENTS.md`);
    process.exit(1);
  }
}

console.log('agent 自动规则文件检查通过');
