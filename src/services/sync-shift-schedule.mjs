// src/services/sync-shift-schedule.mjs - 排期表 → shift_schedule 表同步
// 解析: 时间对切分法(场次车型名含数字, 禁用 [^\d] 惰性正则); 幂等 UPSERT
// 可独立执行: node src/services/sync-shift-schedule.mjs [--days 27]
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { DATA_DIR } from '../utils/monitor-utils.mjs';

const LARK = 'C:/Users/HTF2026/.workbuddy/binaries/node/cli-connector-packages/lark-cli.cmd';
const ENV = { ...process.env, HERMES_HOME: 'C:/Users/HTF2026/AppData/Local/hermes' };
const PAIQI_TOKEN = 'O8ZQsMvhAhE0UftwT3fcoC6cnlh', PAIQI_SHEET = 'x4KDp5';
const DB_PATH = DATA_DIR + '/oceanengine.db';

// 抖音直播行 (1-based): 每 区 域占 5 行块, 直播行=块首
const LIVE_ROWS = { '南区营销中心': 3, '北区营销中心': 8, '东区营销中心': 13, '西区营销中心': 18, '中区营销中心': 23 };
// 账户映射
const ACCOUNTS = {
  '南区营销中心': '1842682454270468', '中区营销中心': '1842663909080452',
  '西区营销中心': '1842681830951944', '东区营销中心': '1842681994872135',
  '北区营销中心': '1842683071403332',
};
const COL_C = 3; // 9/1 列(0-based); 9/D 列 = 2 + D

function normModel(s) {
  const t = String(s).toUpperCase().replace(/\s/g, '');
  if (t.includes('T7')) return 'αT7';
  if (t.includes('T1')) return 'T1';
  if (t.includes('T5')) return 'αT5';
  if (t.includes('S5')) return 'αS5';
  if (t.includes('S3')) return 'S3';
  if (t.includes('V9')) return 'V9';
  if (t.includes('KAOLA') || t.includes('考拉')) return 'KAOLAS';
  if (t.includes('阿尔法T')) return 'αT';
  return t;
}

function parseAnnotated(text) {
  const rows = []; let field = '', rowFields = [], inQ = false;
  const pushF = () => { rowFields.push(field); field = ''; };
  const pushR = () => { if (rowFields.length) rows.push(rowFields); rowFields = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; continue; }
    if (c === '"') { inQ = true; continue; }
    if (c === ',') { pushF(); continue; }
    if (c === '\r') continue;
    if (c === '\n') { pushF(); pushR(); continue; }
    field += c;
  }
  pushF(); pushR();
  return rows;
}

export function syncShiftSchedule(days = 27) {
  const colLetter = (n) => { let s2 = ''; while (n > 0) { const r = (n - 1) % 26; s2 = String.fromCharCode(65 + r) + s2; n = Math.floor((n - 1) / 26); } return s2; };
  const range = `A1:${colLetter(2 + days)}30`; // C=3(9/1) .. (2+days)=9/days

  const csv = JSON.parse(execFileSync('cmd.exe',
    ['/c', LARK, 'sheets', '+csv-get', '--spreadsheet-token', PAIQI_TOKEN, '--sheet-id', PAIQI_SHEET, '--range', range],
    { encoding: 'utf-8', timeout: 60000, env: ENV })).data.annotated_csv;

  function parseAnnotatedLocal(text) { return parseAnnotated(text); }
  const allRows = parseAnnotatedLocal(csv);

  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 5000');
  const upsert = db.prepare(`
    INSERT INTO shift_schedule (cst_date, account_id, region_name, session_no, start_min, end_min, car_model, anchor, synced_at)
    VALUES (@cst_date, @account_id, @region_name, @session_no, @start_min, @end_min, @car_model, @anchor, @synced_at)
    ON CONFLICT(cst_date, account_id, session_no) DO UPDATE SET
      start_min=excluded.start_min, end_min=excluded.end_min, car_model=excluded.car_model,
      anchor=excluded.anchor, synced_at=excluded.synced_at
  `);
  const now = new Date().toISOString();
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const [region, rowIdx] of Object.entries(LIVE_ROWS)) {
      const row = allRows[rowIdx - 1] || [];
      const acc = ACCOUNTS[region];
      for (let di = 1; di <= days; di++) {
        const cell = String(row[COL_C - 2 + di] || ''); // 0-based: 9/1=C列=idx2
        if (!cell.trim()) continue;
        // 日期: 2026-09-di
        const cst_date = `2026-09-${String(di).padStart(2, '0')}`;
        const re = /(\d{1,2})[:：](\d{2})\s*[-–—]\s*(\d{1,2})[:：](\d{2})\s*[（(]([^）)]*)[）)]/g;
        let m, no = 0;
        while ((m = re.exec(cell)) !== null) {
          const model = normModel(m[5]);
          if (!model) continue;
          no++;
          upsert.run({
            cst_date, account_id: acc, region_name: region, session_no: no,
            start_min: Number(m[1]) * 60 + Number(m[2]), end_min: Number(m[3]) * 60 + Number(m[4]),
            car_model: model, anchor: '', synced_at: now,
          });
          inserted++;
        }
      }
    }
  });
  tx();
  const total = db.prepare('SELECT COUNT(*) n FROM shift_schedule').get().n;
  db.close();
  return { inserted, total };
}

// 直接执行
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('sync-shift-schedule.mjs')) {
  const days = Number(process.argv[2]?.match(/--days (\d+)/)?.[1]) || 27;
  const r = syncShiftSchedule(days);
  console.log(`[shift-schedule] 同步完成: 新写入 ${r.inserted} 场次, 表内总计 ${r.total}`);
}
