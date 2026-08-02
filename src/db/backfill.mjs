// db/backfill.mjs — 扫描 monitor-data/*.json 快照回灌到 snapshots 表
// 用法: node db/backfill.mjs
//
// 说明:
//   - 仅回灌 2026-*.json (含 campaign 明细的快照)
//   - 5m-*.json 只有账户级汇总，跳过
//   - 文件名即 snapshot_time (格式: 2026-06-12T09-00-21)
//   - 幂等: 同一 (campaign_id, snapshot_time) 重跑覆盖
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DB_PATH = path.join(PROJECT_ROOT, 'monitor-data', 'oceanengine.db');
const DATA_DIR = path.join(PROJECT_ROOT, 'monitor-data');

// 从文件名解析 snapshot_time (2026-06-12T09-00-21 → 2026-06-12T09:00:21)
function parseTimeFromFilename(filename) {
  const base = filename.replace(/\.json$/, '');
  // 形如 2026-06-12T09-00-21
  const m = base.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}T${m[2]}:${m[3]}:${m[4]}`;
  return null;
}

function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

function backfill() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('[backfill] 数据库不存在，请先执行 db/init.mjs');
    process.exit(1);
  }

  const files = fs.readdirSync(DATA_DIR)
    .filter(f => /^2026-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  console.log(`[backfill] 找到 ${files.length} 个快照文件`);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 预编译语句
  const upsertCampaign = db.prepare(`
    INSERT INTO campaigns(campaign_id, name, status, daily_budget, bid, updated_at)
    VALUES (@campaign_id, @name, @status, @daily_budget, @bid, datetime('now'))
    ON CONFLICT(campaign_id) DO UPDATE SET
      name=excluded.name, status=excluded.status, daily_budget=excluded.daily_budget,
      bid=excluded.bid, updated_at=datetime('now')
  `);

  // 幂等插入: 同一 (campaign_id, snapshot_time) 先删后插
  const deleteExisting = db.prepare(
    `DELETE FROM snapshots WHERE campaign_id=? AND snapshot_time=?`
  );
  const insertSnapshot = db.prepare(`
    INSERT INTO snapshots(
      snapshot_time, campaign_id, cost, leads, conversions,
      msg_open, msg_lead, form_submit, ctr, cpm, cvr,
      views, views_1min, comments, page_summary_json, raw_json
    ) VALUES (
      @snapshot_time, @campaign_id, @cost, @leads, @conversions,
      @msg_open, @msg_lead, @form_submit, @ctr, @cpm, @cvr,
      @views, @views_1min, @comments, @page_summary_json, @raw_json
    )
  `);


  let processedFiles = 0;
  let processedRows = 0;
  let skippedFiles = 0;
  const startTs = Date.now();

  for (const file of files) {
    const snapshotTime = parseTimeFromFilename(file);
    if (!snapshotTime) { skippedFiles++; continue; }

    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
    } catch (e) {
      console.warn(`[backfill] 解析失败 ${file}: ${e.message}`);
      skippedFiles++;
      continue;
    }

    // 兼容字段名: active 数组 (v3格式)
    const campaigns = data.active || data.campaigns || [];
    if (campaigns.length === 0) {
      skippedFiles++;
      continue;
    }

    try {
      const fileTx = db.transaction(() => {
        for (const c of campaigns) {
          if (!c.id) continue;
          // upsert campaign 主表
          const budgetNum = parseFloat(String(c.budget || '0').replace(/,/g, '')) || 0;
          const bidNum = parseFloat(String(c.bid || '').replace(/[^\d.]/g, '')) || null;
          upsertCampaign.run({
            campaign_id: String(c.id),
            name: c.name || '',
            status: c.status || '',
            daily_budget: budgetNum,
            bid: bidNum,
          });
          // 删除旧记录保证幂等
          deleteExisting.run(String(c.id), snapshotTime);
          insertSnapshot.run({
            snapshot_time: snapshotTime,
            campaign_id: String(c.id),
          cost: num(c.spend),
          leads: num(c.leads),
          conversions: num(c.conversions),
          msg_open: num(c.privateMsgOpen),
          msg_lead: num(c.privateMsgRetain),
          form_submit: num(c.formSubmit),
          ctr: num(c.ctr),
          cpm: num(c.cpm),
          cvr: num(c.cvr),
          views: num(c.liveViews),
          views_1min: num(c.liveOver1Min),
          comments: num(c.liveComments),
          page_summary_json: data.summary ? JSON.stringify(data.summary) : null,
          raw_json: JSON.stringify(c),
        });
        processedRows++;
      }
      });
      fileTx();
      processedFiles++;
    } catch (e) {
      console.warn(`[backfill] 文件 ${file} 写入失败: ${e.message}`);
      skippedFiles++;
    }

    if (processedFiles % 200 === 0) {
      const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
      console.log(`[backfill] 进度 ${processedFiles}/${files.length} 文件, ${processedRows} 行, 用时 ${elapsed}s`);
    }
  }

  // 更新回灌时间戳
  db.prepare(
    `INSERT INTO config(key, value, updated_at) VALUES('last_backfill', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).run(new Date().toISOString());

  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  const totalCampaigns = db.prepare('SELECT COUNT(*) as n FROM campaigns').get().n;
  const totalSnapshots = db.prepare('SELECT COUNT(*) as n FROM snapshots').get().n;
  console.log(`\n[backfill] 完成: ${processedFiles} 文件 / ${processedRows} 行 / 跳过 ${skippedFiles}`);
  console.log(`[backfill] campaigns 表: ${totalCampaigns} 条`);
  console.log(`[backfill] snapshots 表: ${totalSnapshots} 条`);
  console.log(`[backfill] 耗时 ${elapsed}s`);

  db.close();
}

backfill();
