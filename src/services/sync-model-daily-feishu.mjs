// sync-model-daily-feishu.mjs — 每日同步前一日车型消耗到飞书「日维度车型消耗」sheet (UQ46JE)
// 数据源: agg_daily_model(日消耗) + agg_month_cum(月累计) — 统一数据层核算表
// 布局: 每天 7 行块 (南/中/西/福/东/北/日累计), C-J 日消耗, K-R 月累, 日期递减(新块在顶部)
// IO: node 直调 lark-cli run.js (绕开 cmd 批处理 → 引号/编码间歇损坏根治)
// 用法: node src/services/sync-model-daily-feishu.mjs [--date 2026-09-21] [--force]
// 退出码: 0=已同步 3=核算数据缺失(等待重试) 其他=错误
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR, ACCOUNT_ID } from '../utils/monitor-utils.mjs';

const SPREADSHEET = 'GiNOslsWQhyHDPtclPscns3GnAf';
const SHEET_ID = 'UQ46JE';
const LARK_RUN = 'C:/Users/HTF2026/.workbuddy/binaries/node/cli-connector-packages/node_modules/@larksuite/cli/scripts/run.js';
const NODE_EXE = process.env.NODE_EXE || 'C:/Users/HTF2026/.workbuddy/binaries/node/versions/22.22.2-3/node.exe';
const LOCK_FILE = path.join(DATA_DIR, 'model-daily-sync.lock');
const MODELS = ['αT7', 'T1', 'S3', 'αS5', 'αT5', 'V9', 'KAOLAS', 'αT'];
const ROW_ACCOUNTS = [
  ['南区营销中心', '1842682454270468'],
  ['中区营销中心', '1842663909080452'],
  ['西区营销中心', '1842681830951944'],
  ['福利营销中心', ACCOUNT_ID || '1842681352509635'],
  ['东区营销中心', '1842681994872135'],
  ['北区营销中心', '1842683071403332'],
];
const env = { ...process.env, HERMES_HOME: 'C:/Users/HTF2026/AppData/Local/hermes' };
const log = (...m) => console.log(`[model-daily-sync ${new Date().toLocaleTimeString('zh-CN')}]`, ...m);

// ---------- 参数 ----------
const argDate = (() => {
  const i = process.argv.indexOf('--date');
  if (i > 0) return process.argv[i + 1];
  const y = new Date(Date.now() + 8 * 3600000 - 86400000);
  return y.toISOString().slice(0, 10);
})();

let lock = {};
try { lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); } catch {}
if (lock[argDate] && !process.argv.includes('--force')) {
  log(`${argDate} 已于 ${lock[argDate]} 同步过, 跳过`);
  process.exit(0);
}

// ---------- ① 核算表数据 ----------
const db = new Database(path.join(DATA_DIR, 'oceanengine.db'), { readonly: true });
const dailyByAcc = {};
for (const [, acc] of ROW_ACCOUNTS) {
  dailyByAcc[acc] = Object.fromEntries(MODELS.map(m => [m, 0]));
  for (const r of db.prepare('SELECT model, cost FROM agg_daily_model WHERE cst_date=? AND account_id=?').all(argDate, acc)) {
    if (r.model in dailyByAcc[acc]) dailyByAcc[acc][r.model] = Math.round(r.cost || 0);
  }
}
const cumByAcc = {};
for (const [, acc] of ROW_ACCOUNTS) {
  cumByAcc[acc] = Object.fromEntries(MODELS.map(m => [m, 0]));
  for (const r of db.prepare('SELECT model, month_cost FROM agg_month_cum WHERE cst_date=? AND account_id=?').all(argDate, acc)) {
    if (r.model in cumByAcc[acc]) cumByAcc[acc][r.model] = Math.round(r.month_cost || 0);
  }
}
db.close();

const hasDaily = ROW_ACCOUNTS.some(([, acc]) => Object.values(dailyByAcc[acc]).some(v => v > 0));
const hourCst = Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 13));
if (!hasDaily) {
  if (hourCst < 12 && process.argv.includes('--retry-ok')) {
    log(`${argDate} 核算数据缺失(statQuery 延迟?), 退出等待下轮重试`);
    process.exit(3);
  }
  log(`❌ ${argDate} agg_daily_model 无数据 — calc-engine 未产出, 不写空值`);
  process.exit(3);
}
log(`核算数据就绪: ${argDate}`);

// ---------- ② lark-cli IO (node 直调, --cells 走 @file 相对路径) ----------
function lark(args) {
  const out = execFileSync(NODE_EXE, [LARK_RUN, ...args], { encoding: 'utf-8', timeout: 120000, env, maxBuffer: 16 * 1024 * 1024 });
  const i = out.indexOf('{');
  if (i < 0) throw new Error('lark-cli 无JSON输出: ' + out.slice(0, 100));
  const j = JSON.parse(out.slice(i));
  if (j.ok === false) throw new Error('lark-cli: ' + JSON.stringify(j.error || j).slice(0, 150));
  return j;
}
const cellsFile = (obj) => {
  const rel = path.join('monitor-data', `model-daily-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
  const abs = path.join(process.cwd(), rel);
  fs.writeFileSync(abs, JSON.stringify(obj));
  return { rel: './' + rel.replace(/\\/g, '/'), abs };
};

function parseGrid() {
  const j = lark(['sheets', '+csv-get', '--spreadsheet-token', SPREADSHEET, '--sheet-id', SHEET_ID, '--range', 'A1:R60']);
  const text = j.data.annotated_csv;
  const rows = [];
  let f = '', rf = [], q = false;
  const pf = () => { rf.push(f); f = ''; };
  const pr = () => { if (rf.length) rows.push(rf); rf = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '[' && f === '' && rf.length === 0) {
      const m = text.slice(i).match(/^\[row=(\d+)\]/);
      if (m) { i += m[0].length - 1; continue; }
    }
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') { q = true; continue; }
    if (c === ',') { pf(); continue; }
    if (c === '\r') continue;
    if (c === '\n') { pf(); pr(); continue; }
    f += c;
  }
  pf(); pr();
  const grid = {};
  rows.forEach((r, k) => { grid[k + 1] = r; }); // A1:R60 连续读出, rows[k] = 表行 k+1
  return grid;
}

const dateKeyOf = (s) => {
  const m = String(s || '').match(/2026[\/-](\d{1,2})[\/-](\d{1,2})/);
  return m ? `2026-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}` : null;
};
const isZeroish = (v) => { const t = String(v || '').trim(); return !t || t === '0' || t === '¥0.00' || t === '0.00'; };

// ---------- ③ 块识别 + 空壳清理 + 写入 ----------
let grid = parseGrid();
const byDate = {};
for (const [r, cells] of Object.entries(grid)) {
  const d = dateKeyOf(cells[0]);
  if (!d) continue;
  const rn = Number(r);
  if (!byDate[d] || rn < byDate[d]) byDate[d] = rn;
}
const blocks = {};
for (const [d, start] of Object.entries(byDate)) {
  let nonEmpty = 0;
  for (let off = 0; off < 7; off++) for (let ci = 2; ci < 18; ci++) if (!isZeroish(grid[start + off]?.[ci])) nonEmpty++;
  blocks[d] = { startRow: start, isBlank: nonEmpty === 0 };
}
log('现有日期块:', Object.entries(blocks).map(([d, b]) => `${d}@${b.startRow}${b.isBlank ? '(空壳)' : ''}`).join(' ') || '(无)');

// 空壳块删除 (从下往上, 删后下方块行号上移 7)
const blankRows = Object.values(blocks).filter(b => b.isBlank).map(b => b.startRow).sort((a, b) => b - a);
for (const r of blankRows) {
  log(`删除空壳块 @row${r}`);
  lark(['sheets', '+dim-delete', '--spreadsheet-token', SPREADSHEET, '--sheet-id', SHEET_ID, '--range', `${r}:${r + 6}`, '--yes']);
  for (const b of Object.values(blocks)) if (b.startRow > r) b.startRow -= 7;
}
for (const d of Object.keys(blocks)) if (blocks[d].isBlank) delete blocks[d];

// 目标块
let target = blocks[argDate];
if (!target) {
  grid = parseGrid();
  const row3Blank = [3, 4, 5, 6, 7, 8, 9].every(r => String(grid[r]?.[0] || '').trim() === '' && String(grid[r]?.[1] || '').trim() === '');
  if (row3Blank) {
    log('顶部行 3-9 为空占位, 直接使用');
  } else {
    log(`${argDate} 块不存在, 顶部插入 7 行`);
    lark(['sheets', '+dim-insert', '--spreadsheet-token', SPREADSHEET, '--sheet-id', SHEET_ID, '--position', '3', '--count', '7', '--inherit-style', 'before']);
  }
  // A 列数字日期格式 + A/B 标签
  lark(['sheets', '+cells-set-style', '--spreadsheet-token', SPREADSHEET, '--sheet-id', SHEET_ID, '--range', 'A3:A9', '--number-format', 'yyyy/m/d']);
  const seq = (d) => { const [y, m, dd] = d.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, dd) / 86400000) + 25569; };
  const abRows = [...ROW_ACCOUNTS.map(([name]) => [{ value: seq(argDate) }, { value: '极狐 | ' + name }]), [{ value: seq(argDate) }, { value: '日累计' }]];
  const ab = cellsFile(abRows);
  try {
    lark(['sheets', '+cells-set', '--spreadsheet-token', SPREADSHEET, '--sheet-id', SHEET_ID, '--range', 'A3:B9', '--cells', '@' + ab.rel]);
  } finally { fs.rmSync(ab.abs, { force: true }); }
  log(`${argDate} A/B 标签已写入`);
  target = { startRow: 3 };
}

// ---------- ④ 写 C-R ----------
const s = target.startRow;
const cells = [];
for (const [, acc] of ROW_ACCOUNTS) {
  cells.push([...MODELS.map(m => ({ value: dailyByAcc[acc][m] })), ...MODELS.map(m => ({ value: cumByAcc[acc][m] }))]);
}
const daySum = MODELS.map((_, i) => ROW_ACCOUNTS.reduce((a, [, acc]) => a + dailyByAcc[acc][MODELS[i]], 0));
const cumSum = MODELS.map((_, i) => ROW_ACCOUNTS.reduce((a, [, acc]) => a + cumByAcc[acc][MODELS[i]], 0));
cells.push([...daySum.map(v => ({ value: v })), ...cumSum.map(v => ({ value: v }))]); // 日累计行: C-J 日消耗之和, K-R 月累之和
const cf = cellsFile(cells);
try {
  lark(['sheets', '+cells-set', '--spreadsheet-token', SPREADSHEET, '--sheet-id', SHEET_ID, '--range', `C${s}:R${s + 6}`, '--cells', '@' + cf.rel]);
} finally { fs.rmSync(cf.abs, { force: true }); }
log(`✅ 已写入 ${argDate} 块 @row${s}: 日累计(8车型) ${daySum.join('/')} | 月累(8车型) ${cumSum.join('/')}`);

// ---------- ⑤ lock ----------
lock[argDate] = new Date().toLocaleString('zh-CN');
fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 1));
log('lock 已记录');
