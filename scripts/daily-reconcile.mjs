// scripts/daily-reconcile.mjs - 每日对账: DB 源数据(agg_shift) vs 飞书班次表回写值
// 由 PM2 cron 每日 23:55 调用, 对账「昨日」终值 (全部班次已结束, 无进行中班次的时效干扰)
// 对账项: 逐班次 spend/leads (key = shift_label|anchor); CPL 为衍生值不对账
// 规则:
//   - spend 差 > max(班次消耗*1%, 50元) 或 leads 差 ≠ 0 → 异常
//   - 单侧缺失(DB 有飞书无 / 飞书有 DB 无) → 异常
//   - DB corrected=1 的班次为人工修正, 跳过严格比对 (飞书可能停留修正前值)
// 环境变量:
//   RECON_DATE          目标日期 YYYY-MM-DD, 默认昨日
//   RECON_SPEND_PCT     消耗相对阈值, 默认 0.01 (1%)
//   RECON_SPEND_ABS     消耗绝对阈值(元), 默认 50
// 数字解析铁律: 含千位逗号先 .replace(/,/g,'') 再 parseFloat
// 2026-10-23: 新增 (2026-10-22 试点对账 9 班次全对齐)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import '../src/config/index.mjs';
import { findLarkCli, DATA_DIR } from '../src/utils/monitor-utils.mjs';
import { fetchSheetRowCount, readSheetRange } from '../src/services/shift-sheet-reader.mjs';
import { pushText } from '../src/feishu/guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.OCEANENGINE_DB_PATH || path.join(PROJECT_ROOT, 'monitor-data', 'oceanengine.db');

function log(...args) {
  console.log(`[reconcile] ${new Date().toLocaleString('zh-CN', { hour12: false })} |`, ...args);
}

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 目标日期 (默认昨日)
const TARGET = (() => {
  if (process.env.RECON_DATE) return process.env.RECON_DATE;
  const y = new Date(Date.now() - 24 * 3600 * 1000);
  return localDate(y);
})();
// 飞书日期格式变体: 2026/10/22
const TARGET_SLASH = TARGET.replaceAll('-', '/');

const SPEND_PCT = Number(process.env.RECON_SPEND_PCT || '0.01');
const SPEND_ABS = Number(process.env.RECON_SPEND_ABS || '50');

function parseNum(v) {
  if (v == null) return 0;
  const s = String(v).replace(/,/g, '').trim();
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function normLabel(s) {
  return String(s || '').replace(/：/g, ':').trim();
}

// ---- 1. DB 源数据 ----
let dbRows;
try {
  const db = new Database(DB_PATH, { readonly: true });
  dbRows = db.prepare('SELECT shift_label, anchor, spend, leads, corrected FROM agg_shift WHERE cst_date = ?').all(TARGET);
  db.close();
} catch (e) {
  log('DB 读取失败:', e.message);
  process.exit(1);
}
const dbMap = new Map();
for (const r of dbRows) {
  dbMap.set(`${normLabel(r.shift_label)}|${String(r.anchor || '').trim()}`, {
    spend: parseNum(r.spend), leads: parseNum(r.leads), corrected: !!r.corrected,
  });
}

// ---- 2. 飞书班次表 ----
const lc = findLarkCli();
if (!lc) { log('lark-cli 未找到'); process.exit(1); }
const rc = fetchSheetRowCount({ larkCli: lc });
const csv = readSheetRange(`A2:F${rc}`, { larkCli: lc });

const sheetMap = new Map();
for (const line of csv.split('\n')) {
  const body = line.replace(/^\[row=\d+\]/, '');
  const cols = body.split(',');
  const date = (cols[0] || '').trim();
  if (!date || !(date === TARGET || date === TARGET_SLASH)) continue;
  const label = normLabel(cols[1]);
  const anchor = (cols[2] || '').trim();
  if (!label || !anchor) continue;
  sheetMap.set(`${label}|${anchor}`, {
    spend: parseNum(cols[3]), leads: parseNum(cols[4]),
  });
}

// ---- 3. 对账 ----
const issues = [];
let compared = 0, skippedCorrected = 0;
for (const [key, dbv] of dbMap) {
  const sv = sheetMap.get(key);
  if (!sv) {
    if (dbv.spend > 0 || dbv.leads > 0) {
      issues.push(`❌ 飞书缺行: ${key} (DB 消耗 ${dbv.spend} / 线索 ${dbv.leads})`);
    }
    continue;
  }
  if (dbv.corrected) { skippedCorrected++; continue; }
  compared++;
  const sd = Math.abs(dbv.spend - sv.spend);
  const ld = Math.abs(dbv.leads - sv.leads);
  if (sd > Math.max(dbv.spend * SPEND_PCT, SPEND_ABS)) {
    issues.push(`❌ 消耗不符: ${key} DB=${dbv.spend} 表=${sv.spend} (差 ${sd.toFixed(2)})`);
  }
  if (ld !== 0) {
    issues.push(`❌ 线索不符: ${key} DB=${dbv.leads} 表=${sv.leads} (差 ${ld})`);
  }
}
for (const [key, sv] of sheetMap) {
  if (!dbMap.has(key) && (sv.spend > 0 || sv.leads > 0)) {
    issues.push(`❌ DB 缺行: ${key} (表消耗 ${sv.spend} / 线索 ${sv.leads})`);
  }
}

// ---- 4. 汇总推送 ----
const header = `📋 对账报告 ${TARGET}`;
const base = `DB 班次 ${dbMap.size} | 表班次 ${sheetMap.size} | 严格比对 ${compared}${skippedCorrected ? ` | 人工修正跳过 ${skippedCorrected}` : ''}`;
let text;
if (issues.length === 0) {
  text = `${header}\n\n✅ 全部对齐, 无差异\n${base}`;
} else {
  text = `${header}\n\n⚠️ 发现 ${issues.length} 处差异\n${base}\n\n${issues.slice(0, 15).join('\n')}${issues.length > 15 ? `\n...等共 ${issues.length} 处` : ''}`;
}
log('\n' + text);

const larkCmd = findLarkCli();
if (larkCmd) {
  const r = await pushText(larkCmd, text, process.env.LARK_MONITOR_CHAT_ID);
  log(r.ok ? '✅ 对账报告已推送' : '❌ 推送失败: ' + (r.error || 'unknown'));
  if (!r.ok) process.exit(1);
} else {
  log('lark-cli 未找到, 仅日志');
  process.exit(issues.length ? 1 : 0);
}
process.exit(issues.length ? 1 : 0);
