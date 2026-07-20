// refresh-views.mjs - 物化视图增量刷新
// 从 config.last_materialized_refresh 位点起，增量刷新 hourly_stats / daily_stats / alert_timeline
//
// 用法: node 巨量引擎监控数据库/refresh-views.mjs

import { connect, closeDB } from './dal.mjs';

async function main() {
  const api = connect();
  const db = api.raw;

  // 获取上次刷新位点
  let lastRefresh = '1970-01-01T00:00:00';
  try {
    const cfg = db.prepare("SELECT value FROM config WHERE key='last_materialized_refresh'").get();
    if (cfg) lastRefresh = cfg.value;
  } catch { /* ignore */ }

  console.log(`🔄 物化视图刷新 | 位点: ${lastRefresh}`);

  // 1. hourly_stats 增量
  const newSnaps = db.prepare(`
    SELECT DISTINCT snapshot_cst, campaign_id FROM snapshots
    WHERE snapshot_time > @since
    ORDER BY snapshot_time
  `).all({ since: lastRefresh });

  if (newSnaps.length === 0) {
    console.log('  ⏭ 无新快照，跳过');
  } else {
    const hourlyStmt = db.prepare(`
      INSERT OR REPLACE INTO hourly_stats(stat_date, stat_hour, campaign_id, delta_cost, delta_leads, peak_cost, snap_count)
      SELECT
        substr(snapshot_time, 1, 10) as stat_date,
        CAST(substr(snapshot_cst, 1, 2) AS INTEGER) as stat_hour,
        campaign_id,
        MAX(cost) - MIN(cost) as delta_cost,
        MAX(leads) - MIN(leads) as delta_leads,
        MAX(cost) as peak_cost,
        COUNT(*) as snap_count
      FROM snapshots
      WHERE snapshot_time > @since
      GROUP BY stat_date, stat_hour, campaign_id
      HAVING snap_count >= 2
    `);
    const hResult = hourlyStmt.run({ since: lastRefresh });
    console.log(`  ✅ hourly_stats: ${hResult.changes} 行`);
  }

  // 2. daily_stats 增量
  const dailyStmt = db.prepare(`
    INSERT OR REPLACE INTO daily_stats(stat_date, campaign_id, total_cost, total_leads, avg_ctr, avg_cpm, avg_cvr, peak_hour, peak_cost, snap_count)
    SELECT
      substr(snapshot_time, 1, 10) as stat_date,
      campaign_id,
      MAX(cost) as total_cost,
      MAX(leads) as total_leads,
      AVG(ctr) as avg_ctr,
      AVG(cpm) as avg_cpm,
      AVG(cvr) as avg_cvr,
      (SELECT CAST(substr(snapshot_cst,1,2) AS INTEGER) FROM snapshots s2 WHERE s2.campaign_id = s1.campaign_id AND substr(s2.snapshot_time,1,10) = substr(s1.snapshot_time,1,10) GROUP BY substr(s2.snapshot_cst,1,2) ORDER BY MAX(s2.cost) DESC LIMIT 1) as peak_hour,
      MAX(cost) - MIN(cost) as peak_cost,
      COUNT(*) as snap_count
    FROM snapshots s1
    WHERE snapshot_time > @since
    GROUP BY stat_date, campaign_id
    HAVING snap_count >= 4
  `);
  const dResult = dailyStmt.run({ since: lastRefresh });
  console.log(`  ✅ daily_stats: ${dResult.changes} 行`);

  // 3. alert_timeline (基于 alerts 表)
  const alertStmt = db.prepare(`
    INSERT OR REPLACE INTO alert_timeline(stat_date, stat_hour, campaign_id, alert_count, severity_high, severity_crit)
    SELECT
      substr(alert_time, 1, 10) as stat_date,
      CAST(strftime('%H', alert_time) AS INTEGER) as stat_hour,
      COALESCE(campaign_id, '_account_') as campaign_id,
      COUNT(*) as alert_count,
      SUM(CASE WHEN severity IN ('high','critical') THEN 1 ELSE 0 END) as severity_high,
      SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) as severity_crit
    FROM alerts
    WHERE alert_time > @since
    GROUP BY stat_date, stat_hour, campaign_id
  `);
  const aResult = alertStmt.run({ since: lastRefresh });
  console.log(`  ✅ alert_timeline: ${aResult.changes} 行`);

  // 更新刷新位点
  db.prepare("INSERT OR REPLACE INTO config(key, value, updated_at) VALUES ('last_materialized_refresh', @v, datetime('now','localtime'))")
    .run({ v: new Date().toISOString() });

  console.log('✅ 物化视图刷新完成');
  closeDB();
}

main().catch(e => { console.error('刷新失败:', e); process.exit(1); });
