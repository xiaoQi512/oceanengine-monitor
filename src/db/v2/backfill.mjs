// backfill.mjs - 历史 JSON 快照回灌到 SQLite
// 扫描 monitor-data/ 下所有 2026-*.json (含计划明细的15min快照), 幂等导入
// 跳过 5m-*.json (5分钟快照不含计划明细)
//
// 用法: node 巨量引擎监控数据库/backfill.mjs [--dry-run] [--limit=100]

import { connect, closeDB } from './dal.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..', '..', '..');
const DATA_DIR = process.env.SNAPSHOT_DATA_DIR || path.join(PROJECT_DIR, 'monitor-data');

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : Infinity;

  console.log(`🔄 回灌模式: ${dryRun ? '预览(Dry Run)' : '正式写入'}`);

  // 初始化数据库
  const api = connect();
  console.log(`🗄️ 数据库: ${process.env.OCEANENGINE_DB_PATH || path.join(PROJECT_DIR, 'monitor-data', 'oceanengine.db')}`);

  // 扫描快照文件
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && f.match(/^2026-/) && !f.startsWith('5m-'))
    .sort();

  console.log(`📂 找到 ${files.length} 个候选快照文件`);

  // 获取最后回灌位点
  let lastBackfill = '1970-01-01T00:00:00';
  try {
    const cfg = api.raw.prepare("SELECT value FROM config WHERE key='last_backfill'").get();
    if (cfg) lastBackfill = cfg.value;
  } catch { /* ignore */ }

  let processed = 0, rows = 0, errors = 0;
  for (const f of files) {
    if (processed >= limit) break;

    const filePath = path.join(DATA_DIR, f);
    const stat = fs.statSync(filePath);

    // 跳过已回灌的文件 (基于时间戳)
    if (stat.mtime.toISOString() <= lastBackfill && lastBackfill !== '1970-01-01T00:00:00') {
      continue;
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!data.active || !Array.isArray(data.active)) continue;

      const snapshotTime = data.time || f.replace('.json', '').replace(/-(\d{2})$/, ':$1');

      // 解析 CST 时间
      const cst = new Date(snapshotTime);
      cst.setHours(cst.getHours() + 8);
      const cstStr = cst.toISOString().slice(11, 16);

      const snapshots = [];
      for (const p of data.active) {
        // Upsert campaign (事务内)
        api.campaigns.upsert({
          campaign_id: p.id, name: p.name,
          status: p.rawStatus || p.status,
          daily_budget: p.budget || 0,
        });

        snapshots.push({
          snapshot_time: snapshotTime,
          snapshot_cst: cstStr,
          campaign_id: p.id,
          cost: p.spend || 0,
          leads: p.leads || 0,
          conversions: p.conversions || 0,
          msg_open: p.privateMsgOpen || 0,
          msg_lead: p.privateMsgRetain || 0,
          form_submit: p.formSubmit || 0,
          ctr: p.ctr || 0,
          cpm: p.cpm || 0,
          cvr: p.cvr || 0,
          views: p.liveViews || 0,
          views_1min: p.liveOver1Min || 0,
          comments: p.liveComment || 0,
          source_type: '15min',
          raw_json: null,
        });
      }

      // 处理 allSpending
      for (const p of (data.allSpending || [])) {
        if (snapshots.find(s => s.campaign_id === p.id)) continue;
        api.campaigns.upsert({
          campaign_id: p.id, name: p.name,
          status: p.rawStatus || p.status, daily_budget: p.budget || 0,
        });
        snapshots.push({
          snapshot_time: snapshotTime, snapshot_cst: cstStr,
          campaign_id: p.id, cost: p.spend || 0, leads: p.leads || 0,
          conversions: p.conversions || 0, msg_open: p.privateMsgOpen || 0,
          msg_lead: p.privateMsgRetain || 0, form_submit: p.formSubmit || 0,
          ctr: p.ctr || 0, cpm: p.cpm || 0, cvr: p.cvr || 0,
          views: p.liveViews || 0, views_1min: p.liveOver1Min || 0,
          comments: p.liveComment || 0, source_type: '15min', raw_json: null,
        });
      }

      if (snapshots.length > 0 && !dryRun) {
        api.snapshots.insert(snapshots);
      }

      rows += snapshots.length;
      processed++;

      if (processed % 100 === 0) {
        const pct = ((processed / files.length) * 100).toFixed(1);
        console.log(`  ⏳ ${processed}/${files.length} (${pct}%) | ${rows} 行 | ${f}`);
      }
    } catch (e) {
      errors++;
      if (errors <= 5) console.log(`  ❌ ${f}: ${e.message}`);
    }
  }

  // 更新回灌位点
  if (!dryRun && processed > 0) {
    api.raw.prepare("INSERT OR REPLACE INTO config(key, value, updated_at) VALUES ('last_backfill', @v, datetime('now','localtime'))")
      .run({ v: new Date().toISOString() });
  }

  console.log(`\n✅ 回灌完成: ${processed} 文件, ${rows} 行, ${errors} 错误${dryRun ? ' (预览模式)' : ''}`);
  closeDB();
}

main().catch(e => { console.error('回灌失败:', e); process.exit(1); });
