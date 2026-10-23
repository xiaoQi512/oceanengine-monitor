// scripts/health-daily-report.mjs - 系统健康日报 (23:50, 独立于业务日报, 零侵入)
// 汇总: 常驻进程存活 / 快照年龄 / DB 体积 / 最新备份 / schtasks 心跳 → 推送监控群
// 说明: 23:50 已过直播窗口(23:00), 快照停更为正常, 故快照年龄仅展示不做阈值告警
//       (告警逻辑在 scripts/watchdog.mjs, 带直播窗口判断)
// 2026-10-23: 新增
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import '../src/config/index.mjs'; // 触发 .env 加载
import { findLarkCli, FEISHU_CHAT_ID, DATA_DIR } from '../src/utils/monitor-utils.mjs';
import { pushText } from '../src/feishu/guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const VERSIONS_DIR = 'C:/Users/HTF2026/.workbuddy/binaries/node/versions';
const PM2_CLI = 'C:/Users/HTF2026/.workbuddy/binaries/node/workspace/node_modules/pm2/bin/pm2';
const PM2_HOME = 'C:/Users/HTF2026/.pm2';

// 与 ecosystem.config.cjs resolveNode 同构
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
  console.log(`[health-daily] ${new Date().toLocaleString('zh-CN', { hour12: false })} |`, ...args);
}

// 1. 常驻进程存活
const CORE = [
  'feedback-server', 'chrome-guard', 'feishu-listener', 'live-watcher',
  'shift-pusher', 'action-queue-worker', 'budget-watch',
  'dashboard-tunnel', 'dsh-tunnel', 'dsh-web',
];
let jlist = [];
try {
  const out = execFileSync(resolveNode(), [PM2_CLI, 'jlist'], {
    encoding: 'utf8', timeout: 30000, windowsHide: true,
    maxBuffer: 16 * 1024 * 1024, // 全家桶进程表含 env, 超 execFileSync 默认 1MB → ENOBUFS (2026-10-23 实测)
    env: { ...process.env, PM2_HOME },
  });
  jlist = JSON.parse(out);
} catch (e) {
  log('jlist 失败:', String(e.message).slice(0, 120));
}
const down = CORE.filter(n => {
  const p = jlist.find(x => x.name === n);
  return !p || p.pm2_env.status !== 'online';
});

// 2. 快照年龄 (仅展示)
function latestAgeMin(prefix, suffix) {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => f.startsWith(prefix) && f.endsWith(suffix))
      .sort();
    if (!files.length) return null;
    return Math.round((Date.now() - fs.statSync(path.join(DATA_DIR, files[files.length - 1])).mtimeMs) / 60000);
  } catch { return null; }
}
const fiveMin = latestAgeMin('5m-', '.json');

// 15min 快照: 按 mtime 取最新 (字符串排序会被 accountId 前缀差异干扰, 2026-10-23 实测踩坑)
let snapMin = null;
try {
  let newestMs = 0;
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (f.startsWith('5m-')) continue;
    if (!/(?:\d{4}-\d{2}-\d{2}-)?\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/.test(f)) continue;
    const m = fs.statSync(path.join(DATA_DIR, f)).mtimeMs;
    if (m > newestMs) newestMs = m;
  }
  if (newestMs > 0) snapMin = Math.round((Date.now() - newestMs) / 60000);
} catch {}

// 3. DB 体积 + 最新备份
let dbMB = 0;
try { dbMB = fs.statSync(path.join(PROJECT_ROOT, 'monitor-data', 'oceanengine.db')).size / 1048576; } catch {}
const bakDir = process.env.BACKUP_DIR || path.join(PROJECT_ROOT, 'monitor-data', 'backups');
let bakInfo = '缺失';
try {
  const f = fs.readdirSync(bakDir)
    .filter(x => /^oceanengine-\d{4}-\d{2}-\d{2}(-w\d+)?\.db$/.test(x))
    .sort().pop();
  if (f) {
    const ageMs = Date.now() - fs.statSync(path.join(bakDir, f)).mtimeMs;
    const h = ageMs / 3600000;
    bakInfo = `${f} (${h < 1 ? Math.round(h * 60) + ' 分钟' : Math.round(h) + ' 小时'}前)`;
  }
} catch {}

// 4. schtasks 通道心跳
let hbMin = null;
try {
  hbMin = Math.round((Date.now() - fs.statSync(path.join(DATA_DIR, 'heartbeat-task.json')).mtimeMs) / 60000);
} catch {}

// 组装并推送
const ts = new Date().toLocaleString('zh-CN', { hour12: false });
const lines = [
  '🩺 系统健康日报',
  '',
  `常驻进程: ${CORE.length - down.length}/${CORE.length} online${down.length ? '\n  ⚠️ 异常: ' + down.join(', ') : ''}`,
  `5m 快照: ${fiveMin == null ? '缺失' : fiveMin + ' 分钟前'} | 15min 快照: ${snapMin == null ? '缺失' : snapMin + ' 分钟前'}`,
  `  (23:00 直播结束后快照停更为正常)`,
  `DB: ${dbMB.toFixed(0)} MB | 最新备份: ${bakInfo}`,
  `schtasks 心跳: ${hbMin == null ? '缺失' : hbMin + ' 分钟前'}`,
  '',
  ts,
];
const text = lines.join('\n');
log('\n' + text);

const larkCmd = findLarkCli();
if (!larkCmd) {
  log('lark-cli 未找到, 跳过推送');
  process.exit(1);
}
const r = await pushText(larkCmd, text, FEISHU_CHAT_ID);
if (r.ok) {
  log('✅ 健康日报已推送');
  process.exit(0);
} else {
  log('❌ 推送失败:', r.error || 'unknown');
  process.exit(1);
}
