// scripts/cleanup-snapshots.mjs - 快照自动清理
// 由 PM2 cron 每日 04:00 调用, 跑完即退。
// 范围: monitor-data 根目录的 5m-*.json 与 15min 快照 JSON (含 accountId 前缀)
//       严格按正则匹配, 不碰 daily-*/shifts-*/state 等其他文件
// 行为: mtime 超过保留期的快照 移动 到 archive/snapshots/<YYYY-MM>/ (可逆, 不删除)
// 环境变量:
//   SNAPSHOT_RETENTION_DAYS  保留天数, 默认 30
//   CLEANUP_DRY_RUN          =1 时只统计不移动
// 2026-10-23: 新增 (实测 monitor-data 堆积 25440 个 JSON, 8/17 至今零清理)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/config/index.mjs'; // 触发 .env 加载

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.SNAPSHOT_DATA_DIR || path.join(PROJECT_ROOT, 'monitor-data');
const ARCHIVE_DIR = path.join(PROJECT_ROOT, 'archive', 'snapshots');
const RETENTION_DAYS = Number(process.env.SNAPSHOT_RETENTION_DAYS || '30');
const DRY_RUN = process.env.CLEANUP_DRY_RUN === '1';
const CUTOFF = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;

// 与 watchdog.mjs 同款快照匹配: 15min 快照 (可选 accountId 前缀) + 5m- 前缀
const SNAP_15_RE = /^(?:\d{4}-\d{2}-\d{2}-)?\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/;
const SNAP_5M_RE = /^5m-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/;

function isSnapshot(f) {
  if (f.startsWith('5m-')) return SNAP_5M_RE.test(f);
  return SNAP_15_RE.test(f);
}

function log(...args) {
  console.log(`[cleanup] ${new Date().toLocaleString('zh-CN', { hour12: false })} |`, ...args);
}

let scanned = 0, moved = 0, errors = 0;
const byMonth = new Map(); // YYYY-MM -> count

try {
  const files = fs.readdirSync(DATA_DIR);
  for (const f of files) {
    if (!isSnapshot(f)) continue;
    scanned++;
    let mtime;
    try { mtime = fs.statSync(path.join(DATA_DIR, f)).mtimeMs; } catch { continue; }
    if (mtime >= CUTOFF) continue;

    const d = new Date(mtime);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (DRY_RUN) {
      byMonth.set(month, (byMonth.get(month) || 0) + 1);
      continue;
    }
    const destDir = path.join(ARCHIVE_DIR, month);
    try {
      fs.mkdirSync(destDir, { recursive: true });
      // 同名冲突时追加时间戳后缀, 避免覆盖
      let dest = path.join(destDir, f);
      if (fs.existsSync(dest)) dest = path.join(destDir, f.replace(/\.json$/, `-${Date.now()}.json`));
      fs.renameSync(path.join(DATA_DIR, f), dest);
      moved++;
      byMonth.set(month, (byMonth.get(month) || 0) + 1);
    } catch (e) {
      errors++;
      log(`移动失败: ${f} → ${e.message}`);
    }
  }

  const summary = [...byMonth.keys()].sort()
    .map(m => `  ${m}: ${byMonth.get(m)}`).join('\n');
  log(`${DRY_RUN ? '[DRY-RUN] 待归档' : '已归档'} ${DRY_RUN ? byMonth.size > 0 ? [...byMonth.values()].reduce((a, b) => a + b, 0) : 0 : moved} 个快照 (扫描 ${scanned}, 失败 ${errors}), 阈值 ${RETENTION_DAYS} 天`);
  if (byMonth.size) log('按月分布:\n' + summary);
  process.exit(errors > 0 ? 1 : 0);
} catch (e) {
  log('fatal:', e.message);
  process.exit(1);
}
