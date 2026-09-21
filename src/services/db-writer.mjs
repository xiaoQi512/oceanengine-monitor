// src/services/db-writer.mjs - 统一数据层落库函数 (UPSERT 幂等)
// 消费方: five-min-snapshot(账户页头) / cloud-sync(场次/计划日/官方日耗)
import Database from 'better-sqlite3';
import { DATA_DIR } from '../utils/monitor-utils.mjs';
import path from 'node:path';

let _db = null;
function getDb() {
  if (!_db) {
    const p = path.join(DATA_DIR, 'oceanengine.db');
    _db = new Database(p);
    _db.pragma('journal_mode = WAL');
    _db.pragma('busy_timeout = 5000');
  }
  return _db;
}

const nowCst = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const cstDate = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

/** 账户页头快照落库 (5min 采集器调用) */
export function writeAccountSnapshot({ account_id, snapshot_time, data }) {
  try {
    const db = getDb();
    const n = (v) => (Number(v) || 0);
    db.prepare(`
      INSERT INTO account_snapshots (snapshot_time, cst_date, account_id, spend, impressions, clicks,
        convert_cnt, form_cnt, private_msg_open, raw_json)
      VALUES (@snapshot_time, @cst_date, @account_id, @spend, @impressions, @clicks,
        @convert_cnt, @form_cnt, @private_msg_open, @raw_json)
      ON CONFLICT(snapshot_time, account_id) DO UPDATE SET
        spend=excluded.spend, impressions=excluded.impressions, clicks=excluded.clicks,
        convert_cnt=excluded.convert_cnt, form_cnt=excluded.form_cnt,
        private_msg_open=excluded.private_msg_open, raw_json=excluded.raw_json
    `).run({
      snapshot_time, cst_date: cstDate(), account_id,
      spend: n(data.accountSpend),
      impressions: n(data.impressions),
      clicks: n(data.clicks),
      convert_cnt: n(data.convert_cnt),
      form_cnt: n(data.form),
      private_msg_open: n(data.privateMsgOpen),
      raw_json: JSON.stringify(data).slice(0, 20000),
    });
    return true;
  } catch (e) {
    console.warn(`  ⚠ [db-writer] account_snapshots 写入失败: ${e.message}`);
    return false;
  }
}

/** 直播场次落库 (webcast API 拉取后) */
export function writeLiveRooms({ account_id, rooms, cst_date = cstDate() }) {
  try {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO live_rooms (cst_date, account_id, room_id, title, start_time, end_time, cost, leads, status, pulled_at)
      VALUES (@cst_date, @account_id, @room_id, @title, @start_time, @end_time, @cost, @leads, @status, @pulled_at)
      ON CONFLICT(cst_date, account_id, room_id) DO UPDATE SET
        title=excluded.title, start_time=excluded.start_time, end_time=excluded.end_time,
        cost=excluded.cost, leads=excluded.leads, status=excluded.status, pulled_at=excluded.pulled_at
    `);
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const r of (rooms || [])) {
        stmt.run({
          cst_date, account_id,
          room_id: String(r.room_id || r.id || ''),
          title: String(r.title || r.name || ''),
          start_time: String(r.start_time || r.start || ''),
          end_time: String(r.end_time || r.end || ''),
          cost: Number(r.cost || r.spend || 0),
          leads: Number(r.leads || 0),
          status: String(r.status || ''),
          pulled_at: now,
        });
      }
    });
    tx();
    return true;
  } catch (e) {
    console.warn(`  ⚠ [db-writer] live_rooms 写入失败: ${e.message}`);
    return false;
  }
}

/** 推广计划×日汇总落库 (cloud-sync 最新快照计划 / grouped) */
export function writePromotionDaily({ account_id, campaigns, cst_date = cstDate(), final_flag = 0, classifyDeliveryType }) {
  try {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO promotion_daily (cst_date, account_id, campaign_id, campaign_name, delivery_form, cost, leads, convert_cnt, msg_open, final_flag, updated_at)
      VALUES (@cst_date, @account_id, @campaign_id, @campaign_name, @delivery_form, @cost, @leads, @convert_cnt, @msg_open, @final_flag, @updated_at)
      ON CONFLICT(cst_date, account_id, campaign_id) DO UPDATE SET
        campaign_name=excluded.campaign_name, delivery_form=excluded.delivery_form,
        cost=excluded.cost, leads=excluded.leads, convert_cnt=excluded.convert_cnt,
        msg_open=excluded.msg_open, final_flag=MAX(promotion_daily.final_flag, excluded.final_flag),
        updated_at=excluded.updated_at
    `);
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const c of (campaigns || [])) {
        const name = String(c.name || c.campaign_name || '');
        stmt.run({
          cst_date, account_id,
          campaign_id: String(c.id || c.campaign_id || ''),
          campaign_name: name,
          delivery_form: classifyDeliveryType ? classifyDeliveryType(name) : null,
          cost: Number(c.cost || c.spend || 0),
          leads: Number(c.leads || 0),
          convert_cnt: Number(c.convert_cnt || c.conv || 0),
          msg_open: Number(c.msg_open || c.privateMsgOpen || 0),
          final_flag, updated_at: now,
        });
      }
    });
    tx();
    return true;
  } catch (e) {
    console.warn(`  ⚠ [db-writer] promotion_daily 写入失败: ${e.message}`);
    return false;
  }
}

/** 数据中心官方日耗落库 (昨日口径拉取后) */
export function writeOfficialDaily({ account_id, cst_date, cost, leads }) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO official_daily (cst_date, account_id, cost, leads, pulled_at)
      VALUES (@cst_date, @account_id, @cost, @leads, @pulled_at)
      ON CONFLICT(cst_date, account_id) DO UPDATE SET
        cost=excluded.cost, leads=excluded.leads, pulled_at=excluded.pulled_at
    `).run({ cst_date, account_id, cost: Number(cost) || 0, leads: Number(leads) || 0, pulled_at: new Date().toISOString() });
    return true;
  } catch (e) {
    console.warn(`  ⚠ [db-writer] official_daily 写入失败: ${e.message}`);
    return false;
  }
}
