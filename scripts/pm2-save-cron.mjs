// scripts/pm2-save-cron.mjs - 定期固化 PM2 进程表
// 由 PM2 cron 每 30min 调用, 跑完即退, 幂等零副作用。
// 目的: 防 daemon 死后 resurrect 拿到旧进程表 (2026-10-19 教训: 手动 save 漏一次, 恢复缺进程)
// 2026-10-23: 新增
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSIONS_DIR = 'C:/Users/HTF2026/.workbuddy/binaries/node/versions';
const PM2_CLI = 'C:/Users/HTF2026/.workbuddy/binaries/node/workspace/node_modules/pm2/bin/pm2';
const PM2_HOME = 'C:/Users/HTF2026/.pm2';

// 与 ecosystem.config.cjs resolveNode 同构: current 指针 → 扫描最新 22.x → 系统 Node 兜底
function resolveNode() {
  try {
    const v = fs.readFileSync(path.join(VERSIONS_DIR, 'current'), 'utf8').trim();
    const p = path.join(VERSIONS_DIR, v, 'node.exe');
    if (fs.existsSync(p)) return p;
  } catch {}
  try {
    const dirs = fs.readdirSync(VERSIONS_DIR)
      .filter(d => /^22\.\d+\.\d+/.test(d) && fs.existsSync(path.join(VERSIONS_DIR, d, 'node.exe')))
      .sort();
    if (dirs.length) return path.join(VERSIONS_DIR, dirs[dirs.length - 1], 'node.exe');
  } catch {}
  return 'C:/nodejs/node-v22.19.0-win-x64/node.exe';
}

function log(...args) {
  console.log(`[pm2-save] ${new Date().toLocaleString('zh-CN', { hour12: false })} |`, ...args);
}

try {
  const out = execFileSync(resolveNode(), [PM2_CLI, 'save'], {
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
    env: { ...process.env, PM2_HOME },
  });
  log('OK:', (out || '').replace(/\n/g, ' ').slice(0, 120));
  process.exit(0);
} catch (e) {
  log('FAIL:', String(e.message).slice(0, 200));
  process.exit(1);
}
