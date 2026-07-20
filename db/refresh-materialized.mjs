// db/refresh-materialized.mjs — 增量刷新物化视图
// 用法: node db/refresh-materialized.mjs
//
// 增量策略:
//   - 读取 config.last_materialized_refresh 作为起点
//   - 只处理 snapshots.snapshot_time > 起点 的数据
//   - 由于 snapshots 是累计值，聚合采用 "该小时内末值 - 首值" 作为增量
//   - 幂等: 对同一 stat_hour/stat_date 重算覆盖
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'monitor-data', 'oceanengine.db');
const SCHEMA_PATH = path.join(__dirname, 'schema-materialized.sql');

let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

function ensureSchema() {
  const db = getDb();
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(sql);
}

/**
 * 获取需要刷新的小时列表
 * 策略: 找出 last_refresh 之后所有 snapshots，按 hour 分组
 * 同时包含 last_refresh 所在小时(可能不完整)
 */
function getHoursToRefresh(db, lastRefresh) {
  // 起点 = last_refresh 所在小时的整点 (回退1小时确保覆盖)
  const startDate = new Date(lastRefresh);
  startDate.setUTCMinutes(0, 0, 0);
  startDate.setUTCHours(startDate.getUTCHours() - 1);
  const startStr = startDate.toISOString().replace(/\.\d+Z$/, '');

  const rows = db.prepare(`
    SELECT DISTINCT substr(snapshot_time, 1, 13) AS stat_hour
    FROM snapshots
    WHERE snapshot_time >= ?
    ORDER BY stat_hour
  `).all(startStr);

  return rows.map(r => r.stat_hour); // ['2026-06-28T14', ...]
}

/**
 * 刷新某小时的 hourly_stats
 */
function refreshHour(db, statHour) {
  const statDate = statHour.substring(0, 10);
  const hourStart = `${statHour}:00:00`;
  const hourEnd = `${statHour}:59:59`;

  // 用 CTE 先找出每个 campaign 的首末时间，再 join 取值
  const rows = db.prepare(`
    WITH bounds AS (
      SELECT
        campaign_id,
        MIN(snapshot_time) AS first_time,
        MAX(snapshot_time) AS last_time,
        COUNT(*) AS samples
      FROM snapshots
      WHERE snapshot_time BETWEEN ? AND ?
      GROUP BY campaign_id
    )
    SELECT
      b.campaign_id,
      b.first_time,
      b.last_time,
      b.samples,
      s_first.cost AS first_cost, s_first.leads AS first_leads, s_first.conversions AS first_conv,
      s_first.msg_open AS first_msg_open, s_first.msg_lead AS first_msg_lead, s_first.form_submit AS first_form,
      s_first.views AS first_views, s_first.views_1min AS first_views_1min, s_first.comments AS first_comments,
      s_last.cost AS last_cost, s_last.leads AS last_leads, s_last.conversions AS last_conv,
      s_last.msg_open AS last_msg_open, s_last.msg_lead AS last_msg_lead, s_last.form_submit AS last_form,
      s_last.views AS last_views, s_last.views_1min AS last_views_1min, s_last.comments AS last_comments
    FROM bounds b
    LEFT JOIN snapshots s_first ON s_first.campaign_id = b.campaign_id AND s_first.snapshot_time = b.first_time
    LEFT JOIN snapshots s_last  ON s_last.campaign_id  = b.campaign_id AND s_last.snapshot_time  = b.last_time
  `).all(hourStart, hourEnd);

  if (rows.length === 0) return 0;

  const upsert = db.prepare(`
    INSERT INTO hourly_stats(
      stat_date, stat_hour, campaign_id,
      cost, leads, conversions, msg_open, msg_lead, form_submit,
      views, views_1min, comments, samples, first_time, last_time
    ) VALUES (
      @stat_date, @stat_hour, @campaign_id,
      @cost, @leads, @conversions, @msg_open, @msg_lead, @form_submit,
      @views, @views_1min, @comments, @samples, @first_time, @last_time
    )
    ON CONFLICT(stat_hour, campaign_id) DO UPDATE SET
      cost=excluded.cost, leads=excluded.leads, conversions=excluded.conversions,
      msg_open=excluded.msg_open, msg_lead=excluded.msg_lead, form_submit=excluded.form_submit,
      views=excluded.views, views_1min=excluded.views_1min, comments=excluded.comments,
      samples=excluded.samples, first_time=excluded.first_time, last_time=excluded.last_time
  `);

  const tx = db.transaction(() => {
    for (const r of rows) {
      const delta = (last, first) => Math.max(0, (last || 0) - (first || 0));
      upsert.run({
        stat_date: statDate,
        stat_hour: statHour,
        campaign_id: r.campaign_id,
        cost: delta(r.last_cost, r.first_cost),
        leads: delta(r.last_leads, r.first_leads),
        conversions: delta(r.last_conv, r.first_conv),
        msg_open: delta(r.last_msg_open, r.first_msg_open),
        msg_lead: delta(r.last_msg_lead, r.first_msg_lead),
        form_submit: delta(r.last_form, r.first_form),
        views: delta(r.last_views, r.first_views),
        views_1min: delta(r.last_views_1min, r.first_views_1min),
        comments: delta(r.last_comments, r.first_comments),
        samples: r.samples,
        first_time: r.first_time,
        last_time: r.last_time,
      });
    }
  });
  tx();

  return rows.length;
}

/**
 * 刷新某日的 daily_stats
 */
function refreshDay(db, statDate) {
  const dayStart = `${statDate}T00:00:00`;
  const dayEnd = `${statDate}T23:59:59`;

  const rows = db.prepare(`
    WITH bounds AS (
      SELECT
        campaign_id,
        MIN(snapshot_time) AS first_time,
        MAX(snapshot_time) AS last_time,
        COUNT(*) AS samples,
        AVG(ctr) AS avg_ctr,
        AVG(cpm) AS avg_cpm,
        AVG(cvr) AS avg_cvr
      FROM snapshots
      WHERE snapshot_time BETWEEN ? AND ?
      GROUP BY campaign_id
    )
    SELECT
      b.campaign_id, b.first_time, b.last_time, b.samples,
      b.avg_ctr, b.avg_cpm, b.avg_cvr,
      s_first.cost AS first_cost, s_first.leads AS first_leads, s_first.conversions AS first_conv,
      s_first.msg_open AS first_msg_open, s_first.msg_lead AS first_msg_lead, s_first.form_submit AS first_form,
      s_first.views AS first_views, s_first.views_1min AS first_views_1min, s_first.comments AS first_comments,
      s_last.cost AS last_cost, s_last.leads AS last_leads, s_last.conversions AS last_conv,
      s_last.msg_open AS last_msg_open, s_last.msg_lead AS last_msg_lead, s_last.form_submit AS last_form,
      s_last.views AS last_views, s_last.views_1min AS last_views_1min, s_last.comments AS last_comments
    FROM bounds b
    LEFT JOIN snapshots s_first ON s_first.campaign_id = b.campaign_id AND s_first.snapshot_time = b.first_time
    LEFT JOIN snapshots s_last  ON s_last.campaign_id  = b.campaign_id AND s_last.snapshot_time  = b.last_time
  `).all(dayStart, dayEnd);

  if (rows.length === 0) return 0;

  const upsert = db.prepare(`
    INSERT INTO daily_stats(
      stat_date, campaign_id,
      cost, leads, conversions, msg_open, msg_lead, form_submit,
      views, views_1min, comments, samples, first_time, last_time,
      avg_ctr, avg_cpm, avg_cvr
    ) VALUES (
      @stat_date, @campaign_id,
      @cost, @leads, @conversions, @msg_open, @msg_lead, @form_submit,
      @views, @views_1min, @comments, @samples, @first_time, @last_time,
      @avg_ctr, @avg_cpm, @avg_cvr
    )
    ON CONFLICT(stat_date, campaign_id) DO UPDATE SET
      cost=excluded.cost, leads=excluded.leads, conversions=excluded.conversions,
      msg_open=excluded.msg_open, msg_lead=excluded.msg_lead, form_submit=excluded.form_submit,
      views=excluded.views, views_1min=excluded.views_1min, comments=excluded.comments,
      samples=excluded.samples, first_time=excluded.first_time, last_time=excluded.last_time,
      avg_ctr=excluded.avg_ctr, avg_cpm=excluded.avg_cpm, avg_cvr=excluded.avg_cvr
  `);

  const delta = (last, first) => Math.max(0, (last || 0) - (first || 0));
  const tx = db.transaction(() => {
    for (const r of rows) {
      upsert.run({
        stat_date: statDate,
        campaign_id: r.campaign_id,
        cost: delta(r.last_cost, r.first_cost),
        leads: delta(r.last_leads, r.first_leads),
        conversions: delta(r.last_conv, r.first_conv),
        msg_open: delta(r.last_msg_open, r.first_msg_open),
        msg_lead: delta(r.last_msg_lead, r.first_msg_lead),
        form_submit: delta(r.last_form, r.first_form),
        views: delta(r.last_views, r.first_views),
        views_1min: delta(r.last_views_1min, r.first_views_1min),
        comments: delta(r.last_comments, r.first_comments),
        samples: r.samples,
        first_time: r.first_time,
        last_time: r.last_time,
        avg_ctr: Number(r.avg_ctr || 0).toFixed(6),
        avg_cpm: Number(r.avg_cpm || 0).toFixed(4),
        avg_cvr: Number(r.avg_cvr || 0).toFixed(6),
      });
    }
  });
  tx();

  return rows.length;
}

/**
 * 刷新某小时的 alert_timeline
 */
function refreshAlertTimeline(db, statHour) {
  const statDate = statHour.substring(0, 10);
  const hourStart = `${statHour}:00:00`;
  const hourEnd = `${statHour}:59:59`;

  const rows = db.prepare(`
    SELECT
      campaign_id,
      COUNT(*) AS alert_count,
      SUM(resolved) AS resolved_count,
      MIN(alert_time) AS first_alert,
      MAX(alert_time) AS last_alert,
      GROUP_CONCAT(DISTINCT severity) AS severities
    FROM alerts
    WHERE alert_time BETWEEN ? AND ?
    GROUP BY campaign_id
  `).all(hourStart, hourEnd);

  // 先删除该小时旧记录
  db.prepare(`DELETE FROM alert_timeline WHERE stat_hour = ?`).run(statHour);

  if (rows.length === 0) return 0;

  const insert = db.prepare(`
    INSERT INTO alert_timeline(
      stat_date, stat_hour, campaign_id,
      alert_count, severities, first_alert, last_alert, resolved_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const r of rows) {
      insert.run(
        statDate, statHour, r.campaign_id,
        r.alert_count, r.severities || '', r.first_alert, r.last_alert, r.resolved_count || 0
      );
    }
  });
  tx();

  return rows.length;
}

/**
 * 增量刷新物化视图
 * @returns {{ok:boolean, hours:number, days:number, alerts:number, error?:string}}
 */
export function refreshMaterialized() {
  try {
    const db = getDb();
    ensureSchema();

    // 读取上次刷新时间
    const row = db.prepare(
      `SELECT value FROM config WHERE key='last_materialized_refresh'`
    ).get();
    const lastRefresh = row?.value || '1970-01-01T00:00:00';
    console.log(`[materialized] 上次刷新: ${lastRefresh}`);

    // 获取需要刷新的小时
    const hours = getHoursToRefresh(db, lastRefresh);
    if (hours.length === 0) {
      console.log('[materialized] 无新数据需要刷新');
      return { ok: true, hours: 0, days: 0, alerts: 0 };
    }

    console.log(`[materialized] 待刷新小时: ${hours.length} 个 (${hours[0]} ~ ${hours[hours.length-1]})`);

    let totalHours = 0;
    let totalAlerts = 0;

    // 刷新 hourly_stats 和 alert_timeline
    for (const hour of hours) {
      const n1 = refreshHour(db, hour);
      const n2 = refreshAlertTimeline(db, hour);
      totalHours += n1;
      totalAlerts += n2;
    }

    // 刷新 daily_stats (按日去重)
    const days = [...new Set(hours.map(h => h.substring(0, 10)))];
    let totalDays = 0;
    for (const day of days) {
      totalDays += refreshDay(db, day);
    }

    // 更新刷新时间
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE config SET value=?, updated_at=datetime('now') WHERE key='last_materialized_refresh'`
    ).run(now);

    console.log(`[materialized] 完成: hourly=${totalHours}条, daily=${totalDays}条, alerts=${totalAlerts}条`);
    return { ok: true, hours: totalHours, days: totalDays, alerts: totalAlerts };
  } catch (e) {
    console.error(`[materialized] 刷新失败: ${e.message}`);
    return { ok: false, hours: 0, days: 0, alerts: 0, error: e.message };
  }
}

/**
 * 关闭数据库连接
 */
export function closeDb() {
  if (_db) { _db.close(); _db = null; }
}

// 直接运行入口
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  const r = refreshMaterialized();
  closeDb();
  process.exit(r.ok ? 0 : 1);
}

process.on('exit', () => closeDb());
