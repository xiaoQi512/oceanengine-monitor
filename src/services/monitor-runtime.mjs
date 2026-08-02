// src/services/monitor-runtime.mjs - 15min 监控运行日志轮转与收尾刷新
import fs from 'node:fs';

export function ensureDataDir(dataDir) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

export function rotateRunLog({ logFile }) {
  try {
    fs.appendFileSync(logFile, `\n=== ${new Date().toLocaleString()} ===\n`);
  } catch {}

  try {
    const stat = fs.statSync(logFile);
    if (stat.size > 1024 * 1024) {
      const buf = fs.readFileSync(logFile, 'utf8');
      fs.writeFileSync(logFile, buf.slice(-500 * 1024));
    }
  } catch {}
}

export function refreshMaterializedViews({ refreshMaterialized }) {
  try {
    const r = refreshMaterialized();
    if (r.ok) {
      console.log(`📊 物化视图刷新: hourly=${r.hours}, daily=${r.days}, alerts=${r.alerts}`);
      return { ok: true, hours: r.hours, days: r.days, alerts: r.alerts };
    }
    console.warn(`  ⚠ 物化视图刷新失败: ${r.error}`);
    return { ok: false, error: r.error };
  } catch (e) {
    console.warn(`  ⚠ 物化视图刷新异常: ${e.message}`);
    return { ok: false, error: e.message };
  }
}
