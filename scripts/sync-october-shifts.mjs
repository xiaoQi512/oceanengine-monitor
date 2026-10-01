// scripts/sync-october-shifts.mjs — 10月排期(lEMsTv)→ shift_schedule 同步 (10/1-10/7)
// 结构(竖表): 每账号区块多行; AI 直播行=块首「抖音直播」; 车展活动场嵌在区块文本内(带主播); 福利号真人=「真人出镜直播」行
// 入库: shift_schedule UPSERT (cst_date+account_id+session_no 唯一); 同时写 shifts-YYYY-MM-DD.json 缓存(福利号主播链路用)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR } from '../src/utils/monitor-utils.mjs';

const LARK = 'C:/Users/HTF2026/.workbuddy/binaries/node/cli-connector-packages/lark-cli.cmd';
const ENV = { ...process.env, HERMES_HOME: 'C:/Users/HTF2026/AppData/Local/hermes' };
const TOKEN = 'O8ZQsMvhAhE0UftwT3fcoC6cnlh', OCT_SHEET = 'lEMsTv';

const ACCOUNTS = {
  '南区营销中心': '1842682454270468', '北区营销中心': '1842683071403332',
  '东区营销中心': '1842681994872135', '西区营销中心': '1842681830951944',
  '中区营销中心': '1842663909080452', '福利营销中心': '1842681352509635',
};
const DATES = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']; // 列 C-I

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
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; continue; }
    if (c === '"') { inQ = true; continue; }
    if (c === ',') { rowFields.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { rowFields.push(field); rows.push(rowFields); rowFields = []; field = ''; continue; }
    field += c;
  }
  rowFields.push(field); rows.push(rowFields);
  return rows;
}

// 福利号真人时段: 「6:30-8:30三水(T7)」/「10:30-12:30 三水（T7）」(⏎ 或空格分隔, 全角兼容)
function parseHumanShifts(cell) {
  const out = [];
  const re = /(\d{1,2}[:：]\d{2})\s*[-–—]\s*(\d{1,2}[:：]\d{2})\s*([^\d（(\n]+?)\s*[（(]([^）)]*)[）)]/g;
  let m;
  while ((m = re.exec(cell)) !== null) {
    const toMin = (h, mm) => Number(h) * 60 + Number(mm);
    const st = toMin(m[1].split(/[:：]/)[0], m[1].split(/[:：]/)[1]);
    const en = toMin(m[2].split(/[:：]/)[0], m[2].split(/[:：]/)[1]);
    out.push({ start_min: st, end_min: en, anchor: m[3].trim(), car_model: normModel(m[4]) });
  }
  return out;
}

// AI 时段: 「7:00-9:00(贝塔S3)」/「12：00-14：00(S5)」
function parseAIShifts(cell) {
  const out = [];
  const re = /(\d{1,2}[:：]\d{2})\s*[-–—]\s*(\d{1,2}[:：]\d{2})\s*[（(]([^）)]*)[）)]/g;
  let m;
  while ((m = re.exec(cell)) !== null) {
    const model = normModel(m[3]);
    if (!model) continue;
    const st = m[1].split(/[:：]/), en = m[2].split(/[:：]/);
    out.push({ start_min: Number(st[0]) * 60 + Number(st[1]), end_min: Number(en[0]) * 60 + Number(en[1]), car_model: model });
  }
  return out;
}

// 活动场: 「天津车展直播⏎主播:小明  运营:张万熊⏎直播时间:9:30-11:30⏎12:30-14:30⏎15:30-17:30」
// 车型映射(用户口径 2026-10-01): **近期活动场均播 αT7**(默认), 特例可覆盖
const EVENT_CAR_MODELS = { '天津': 'αT7', '南京': 'αT7' };
function parseEventShifts(cell) {
  const out = [];
  const evRe = /([^\n（(]*?)车展直播/g;
  let ev;
  while ((ev = evRe.exec(cell)) !== null) {
    const evName = ev[1].trim().replace(/.*\n/, '').trim() || '车展';
    const tail = cell.slice(ev.index);
    const anchorM = tail.match(/主播\s*[:：]\s*([^\n运营]+)/);
    const anchor = anchorM ? anchorM[1].trim() : '';
    const timeM = tail.match(/直播时间\s*[:：]?([\s\S]*?)(?:\n[^\d]|$)/);
    const timeText = timeM ? timeM[1] : tail;
    const carModel = EVENT_CAR_MODELS[evName] || 'αT7';
    const re = /(\d{1,2}[:：]\d{2})\s*[-–—]\s*(\d{1,2}[:：]\d{2})/g;
    let m;
    while ((m = re.exec(timeText)) !== null) {
      const st = m[1].split(/[:：]/), en = m[2].split(/[:：]/);
      out.push({ start_min: Number(st[0]) * 60 + Number(st[1]), end_min: Number(en[0]) * 60 + Number(en[1]), car_model: carModel, anchor: '车展·' + anchor });
    }
  }
  return out;
}

// ---- 主流程 ----
// CSV 来源: 沙箱内禁 spawnSync, CSV 已由外部 lark-cli 拉取落盘 (monitor-data/_oct-csv.txt)
const CSV_FILE = path.join(DATA_DIR, '_oct-csv.txt');
const csv = JSON.parse(fs.readFileSync(CSV_FILE, 'utf-8')).data.annotated_csv;
const allRows = parseAnnotated(csv);
const blockStart = {}; // 区块名 → 抖音直播行号(0-based)
let currentBlock = '';
for (const [idx, r] of allRows.entries()) {
  const a = String(r[0] || '');
  for (const name of Object.keys(ACCOUNTS)) {
    if (a.includes(name)) { currentBlock = name; blockStart[name] = { aiRow: idx, categoryRow: idx + 1 }; }
  }
  if (currentBlock && a.trim() === '抖音直播' && blockStart[currentBlock] && blockStart[currentBlock].aiRow === undefined) {
    blockStart[currentBlock].aiRow = idx;
  }
}
console.log('区块定位:', JSON.stringify(Object.fromEntries(Object.entries(blockStart).map(([k, v]) => [k, v.aiRow + 1]))));

const db = new Database(path.join(DATA_DIR, 'oceanengine.db'));
db.pragma('busy_timeout = 5000');
const del = db.prepare('DELETE FROM shift_schedule WHERE cst_date = ? AND account_id = ?');
const upsert = db.prepare(`
  INSERT INTO shift_schedule (cst_date, account_id, region_name, session_no, start_min, end_min, car_model, anchor, synced_at)
  VALUES (@cst_date, @account_id, @region_name, @session_no, @start_min, @end_min, @car_model, @anchor, @synced_at)
  ON CONFLICT(cst_date, account_id, session_no) DO UPDATE SET
    start_min=excluded.start_min, end_min=excluded.end_min, car_model=excluded.car_model,
    anchor=excluded.anchor, synced_at=excluded.synced_at
`);
const now = new Date().toISOString();
let inserted = 0;
const cacheByDay = {}; // 福利号缓存 json

const tx = db.transaction(() => {
  for (const [region, loc] of Object.entries(blockStart)) {
    const acc = ACCOUNTS[region];
    for (let di = 0; di < DATES.length; di++) {
      const cst_date = DATES[di];
      const cell = String((allRows[loc.aiRow] || [])[2 + di] || '');
      if (!cell.trim()) continue;
      // 清旧(全量重建该区该日)
      del.run(cst_date, acc);
      // AI 时段
      const ai = parseAIShifts(cell);
      // 活动场(车展) — 仅五大区
      const isFuli = region === '福利营销中心';
      const events = isFuli ? [] : parseEventShifts(cell);
      // 福利号真人时段
      const human = isFuli ? parseHumanShifts(cell) : [];
      const all = [
        ...ai.map(x => ({ ...x, anchor: '' })),
        ...events.map(x => ({ ...x })),
        ...human.map(x => ({ ...x })),
      ].sort((a, b) => a.start_min - b.start_min);
      all.forEach((s, i) => {
        upsert.run({
          cst_date, account_id: acc, region_name: region, session_no: i + 1,
          start_min: s.start_min, end_min: s.end_min, car_model: s.car_model || '', anchor: s.anchor || '', synced_at: now,
        });
        inserted++;
        if (isFuli && s.anchor) {
          (cacheByDay[cst_date] = cacheByDay[cst_date] || { date: cst_date, shifts: [] }).shifts.push({
            label: `${String(Math.floor(s.start_min / 60)).padStart(2, '0')}:${String(s.start_min % 60).padStart(2, '0')}-${String(Math.floor(s.end_min / 60)).padStart(2, '0')}:${String(s.end_min % 60).padStart(2, '0')}`,
            startHour: Math.floor(s.start_min / 60), startMinute: s.start_min % 60,
            endHour: Math.floor(s.end_min / 60), endMinute: s.end_min % 60,
            anchorName: s.anchor, carModel: s.car_model,
          });
        }
      });
    }
  }
});
tx();
db.close();
// 福利号缓存(每天一个 json, shift-pusher/换班链路兼容)
for (const [day, obj] of Object.entries(cacheByDay)) {
  obj.startHour = obj.shifts[0]?.startHour ?? 6; obj.startMinute = obj.shifts[0]?.startMinute ?? 30;
  const last = obj.shifts[obj.shifts.length - 1];
  obj.endHour = last?.endHour ?? 23; obj.endMinute = last?.endMinute ?? 30;
  obj.startTime = `${String(obj.startHour).padStart(2, '0')}:${String(obj.startMinute).padStart(2, '0')}`;
  obj.endTime = `${String(obj.endHour).padStart(2, '0')}:${String(obj.endMinute).padStart(2, '0')}`;
  fs.writeFileSync(path.join(DATA_DIR, `shifts-${day}.json`), JSON.stringify(obj, null, 2));
}
console.log(`[oct-shifts] ✅ 同步完成: 新写入 ${inserted} 场次 (10/1-10/7), 福利号缓存 ${Object.keys(cacheByDay).length} 天`);
