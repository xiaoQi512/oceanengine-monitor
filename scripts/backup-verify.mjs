// scripts/backup-verify.mjs — SQLite 备份验证（本地 + CI 双模式）
// 退出码: 0 = 全部通过, 1 = 任一校验失败
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'monitor-data', 'oceanengine.db');
const SCHEMA_PATH = path.join(PROJECT_ROOT, 'src', 'db', 'schema.sql');

// 关键表名（schema.sql 中定义的 6 张基础表）
const KEY_TABLES = ['campaigns', 'snapshots', 'alerts', 'actions', 'feedback', 'config'];

let failures = 0;

function fail(msg) {
  console.error(`  FAIL  ${msg}`);
  failures++;
}

function ok(msg) {
  console.log(`  PASS  ${msg}`);
}

// ====== 本地模式：验证真实数据库 ======

function verifyRealDatabase() {
  console.log('\n=== 本地模式：验证真实数据库 ===');
  console.log(`  数据库路径: ${DB_PATH}`);

  const stat = fs.statSync(DB_PATH);
  console.log(`  文件大小: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

  // 复制到临时文件（不污染原库）
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-verify-'));
  const tmpDb = path.join(tmpDir, 'verify.db');
  fs.copyFileSync(DB_PATH, tmpDb);

  let db;
  try {
    db = new Database(tmpDb, { readonly: true });

    // 1. PRAGMA integrity_check
    console.log('\n  [1] PRAGMA integrity_check');
    const integrity = db.pragma('integrity_check');
    if (integrity.length === 1 && integrity[0].integrity_check === 'ok') {
      ok('integrity_check = ok');
    } else {
      fail(`integrity_check 失败: ${JSON.stringify(integrity)}`);
    }

    // 2. PRAGMA quick_check（快速扫描）
    const quick = db.pragma('quick_check');
    if (quick.length === 1 && quick[0].quick_check === 'ok') {
      ok('quick_check = ok');
    } else {
      fail(`quick_check 失败: ${JSON.stringify(quick)}`);
    }

    // 3. PRAGMA foreign_key_check
    const fk = db.pragma('foreign_key_check');
    if (fk.length === 0) {
      ok('foreign_key_check = 0 违规');
    } else {
      fail(`foreign_key_check 发现 ${fk.length} 条违规`);
    }

    // 4. 关键表行数
    console.log('\n  [2] 关键表行数');
    for (const table of KEY_TABLES) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get();
        const count = row?.cnt ?? 0;
        const sizeStr = count >= 0 ? `${count} 行` : '?';
        console.log(`    ${table}: ${sizeStr}`);
      } catch {
        console.log(`    ${table}: (不存在或无法访问)`);
      }
    }

    // 5. 抽样校验：snapshots 最近一条记录
    console.log('\n  [3] 抽样校验: snapshots 最新 3 条');
    try {
      const latest = db.prepare('SELECT snapshot_time, campaign_id, cost FROM snapshots ORDER BY snapshot_time DESC LIMIT 3').all();
      for (const row of latest) {
        const time = row.snapshot_time || '?';
        const cid = row.campaign_id || '?';
        const cost = row.cost != null ? row.cost.toFixed(2) : '?';
        console.log(`    ${time}  campaign=${cid}  cost=¥${cost}`);
      }
      if (latest.length === 0) {
        console.log('    (无数据)');
      }
    } catch (e) {
      fail(`snapshots 查询失败: ${e.message}`);
    }

  } catch (e) {
    fail(`数据库操作异常: ${e.message}`);
  } finally {
    if (db) db.close();
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
}

// ====== CI 模式：完整备份-恢复演练 ======

function runStatements(db, sql) {
  // better-sqlite3 的 exec() 原生支持多语句执行
  db.exec(sql);
}

function verifyCiDatabase() {
  console.log('\n=== CI 模式：备份-恢复完整演练 ===');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-verify-ci-'));
  const dbFile = path.join(tmpDir, 'test.db');
  const backupFile = path.join(tmpDir, 'test-backup.db');

  try {
    // 阶段 1: 建库
    console.log('\n  [1] 从 schema.sql 创建测试数据库');
    const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    let db = new Database(dbFile);
    runStatements(db, schemaSql);
    ok('schema 执行成功');

    // 阶段 2: 插入测试数据
    console.log('\n  [2] 插入测试数据');
    db.prepare(`INSERT INTO campaigns (campaign_id, name, status, daily_budget, bid)
      VALUES (?, ?, ?, ?, ?)`).run('test_camp_001', 'CI测试计划', '启用中', 1000, 50);
    db.prepare(`INSERT INTO campaigns (campaign_id, name, status, daily_budget, bid)
      VALUES (?, ?, ?, ?, ?)`).run('test_camp_002', 'CI测试计划2', '启用中', 2000, 80);

    db.prepare(`INSERT INTO snapshots (snapshot_time, campaign_id, cost, leads, conversions)
      VALUES (?, ?, ?, ?, ?)`).run('2026-07-25T10:00:00Z', 'test_camp_001', 150.5, 3, 1);
    db.prepare(`INSERT INTO snapshots (snapshot_time, campaign_id, cost, leads, conversions)
      VALUES (?, ?, ?, ?, ?)`).run('2026-07-25T10:05:00Z', 'test_camp_001', 180.0, 4, 1);
    db.prepare(`INSERT INTO snapshots (snapshot_time, campaign_id, cost, leads, conversions)
      VALUES (?, ?, ?, ?, ?)`).run('2026-07-25T10:00:00Z', 'test_camp_002', 300.0, 5, 2);

    db.prepare(`INSERT INTO alerts (alert_time, alert_type, severity, campaign_id, message)
      VALUES (?, ?, ?, ?, ?)`).run('2026-07-25T10:30:00Z', 'cpa_high', 'medium', 'test_camp_001', 'CI test alert');

    // 验证插入数据
    const campCount = db.prepare('SELECT COUNT(*) as cnt FROM campaigns').get().cnt;
    const snapCount = db.prepare('SELECT COUNT(*) as cnt FROM snapshots').get().cnt;
    const alertCount = db.prepare('SELECT COUNT(*) as cnt FROM alerts').get().cnt;
    console.log(`    campaigns: ${campCount} 行, snapshots: ${snapCount} 行, alerts: ${alertCount} 行`);
    ok('测试数据插入成功');

    // 记录关键校验值
    const expectedCampIds = ['test_camp_001', 'test_camp_002'];
    const expectedTotalCost = 150.5 + 180.0 + 300.0;

    db.close();

    // 阶段 3: 备份
    console.log('\n  [3] 备份数据库');
    fs.copyFileSync(dbFile, backupFile);
    const backupSize = fs.statSync(backupFile).size;
    console.log(`    备份文件: ${backupSize} 字节`);
    ok('备份完成');

    // 阶段 4: 删除原库
    console.log('\n  [4] 删除原库（模拟灾难）');
    fs.unlinkSync(dbFile);
    const dbExistsAfterDelete = fs.existsSync(dbFile);
    if (!dbExistsAfterDelete) {
      ok('原库已删除');
    } else {
      fail('原库删除失败');
    }

    // 阶段 5: 从备份恢复
    console.log('\n  [5] 从备份恢复');
    fs.copyFileSync(backupFile, dbFile);
    const restoredSize = fs.statSync(dbFile).size;
    if (restoredSize === backupSize) {
      ok(`恢复成功 (${restoredSize} 字节)`);
    } else {
      fail(`恢复文件大小不匹配: 期望 ${backupSize}, 实际 ${restoredSize}`);
    }

    // 阶段 6: 验证恢复后的数据库
    console.log('\n  [6] 验证恢复后的数据库');
    db = new Database(dbFile, { readonly: true });

    // 6a. integrity check
    const integrity = db.pragma('integrity_check');
    if (integrity.length === 1 && integrity[0].integrity_check === 'ok') {
      ok('integrity_check = ok');
    } else {
      fail(`integrity_check 失败: ${JSON.stringify(integrity)}`);
    }

    // 6b. 表结构完整
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const tableNames = tables.map(t => t.name);
    for (const expected of KEY_TABLES) {
      if (tableNames.includes(expected)) {
        console.log(`    表 ${expected}: 存在`);
      } else {
        fail(`表 ${expected}: 缺失`);
      }
    }

    // 6c. 数据一致性 - 行数
    const restoredCampCount = db.prepare('SELECT COUNT(*) as cnt FROM campaigns').get().cnt;
    const restoredSnapCount = db.prepare('SELECT COUNT(*) as cnt FROM snapshots').get().cnt;
    const restoredAlertCount = db.prepare('SELECT COUNT(*) as cnt FROM alerts').get().cnt;

    let dataOk = true;
    if (restoredCampCount !== campCount) { fail(`campaigns 行数: ${restoredCampCount} (期望 ${campCount})`); dataOk = false; }
    if (restoredSnapCount !== snapCount) { fail(`snapshots 行数: ${restoredSnapCount} (期望 ${snapCount})`); dataOk = false; }
    if (restoredAlertCount !== alertCount) { fail(`alerts 行数: ${restoredAlertCount} (期望 ${alertCount})`); dataOk = false; }
    if (dataOk) ok('数据行数一致');

    // 6d. 数据一致性 - 值
    const restoredCamps = db.prepare('SELECT campaign_id FROM campaigns ORDER BY campaign_id').all();
    const restoredIds = restoredCamps.map(r => r.campaign_id);
    if (JSON.stringify(restoredIds) === JSON.stringify(expectedCampIds)) {
      ok('campaign_id 列表一致');
    } else {
      fail(`campaign_id 不匹配: ${JSON.stringify(restoredIds)} (期望 ${JSON.stringify(expectedCampIds)})`);
    }

    const restoredTotalCost = db.prepare('SELECT SUM(cost) as total FROM snapshots').get().total;
    if (Math.abs(restoredTotalCost - expectedTotalCost) < 0.01) {
      ok(`snapshots 总 cost 一致: ¥${restoredTotalCost.toFixed(2)}`);
    } else {
      fail(`snapshots 总 cost 不匹配: ¥${restoredTotalCost.toFixed(2)} (期望 ¥${expectedTotalCost.toFixed(2)})`);
    }

    db.close();
    console.log('\n  ✅ CI 备份-恢复演练全部通过');

  } catch (e) {
    fail(`CI 验证异常: ${e.message}`);
    console.error(e);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
}

// ====== 主入口 ======

console.log('backup-verify — SQLite 备份验证');
console.log('================================');

const dbExists = fs.existsSync(DB_PATH);

if (dbExists) {
  verifyRealDatabase();
} else {
  console.log(`\n真实数据库不存在 (${DB_PATH})，切换到 CI 模式`);
  verifyCiDatabase();
}

console.log('\n================================');
if (failures > 0) {
  console.log(`失败: ${failures} 项`);
  process.exit(1);
} else {
  console.log('全部通过');
  process.exit(0);
}
