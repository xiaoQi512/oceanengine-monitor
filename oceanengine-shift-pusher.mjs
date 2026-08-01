// oceanengine-shift-pusher.mjs - 主播换班数据推送常驻守护脚本（动态轮询版）
// 由 PM2 托管，每60秒轮询检测班次结束，HTTP API 拉数据 -> 写飞书表 -> 推飞书群
// 排班来源：优先读 monitor-data/shifts-YYYY-MM-DD.json（sync-tomorrow-shifts.mjs 23:00 同步）
//           缓存缺失时实时从飞书排班表读取
// 日终任务：最后一场结束后自动触发 sync-tomorrow / daily-report / daily-summary / ai-regions
//
// 环境变量：
//   OEC_SILENT=1   静默模式（console.* 重定向到日志文件，由 monitor-utils 处理）
//   OEC_FORCE=1    强制触发当前时段（测试用，跳过轮询等待）
//   OEC_DRY_RUN=1  只拉数据不推送（验证数据源）
//
// 用法：
//   常驻: pm2 start ecosystem.config.cjs --only shift-pusher
//   测试: OEC_FORCE=1 OEC_DRY_RUN=1 node oceanengine-shift-pusher.mjs
//   手推: OEC_FORCE=1 node oceanengine-shift-pusher.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from './oceanengine-api-client.mjs';
import { getShiftDelta } from './巨量引擎快照数据库/snapshot-db.mjs';
import {
  findLarkCli, DATA_DIR, getLocalDate, atomicWriteJSON, getShiftsPerDay, getShiftRowForDate,
  SHIFT_SPREADSHEET_TOKEN as SPREADSHEET_TOKEN, SHIFT_SHEET_ID as SHEET_ID,
  FEISHU_ANCHOR_CHAT_ID as SHIFT_CHAT_ID, ACCOUNT_ID,
} from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OEC_FORCE = process.env.OEC_FORCE === '1';
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === '1';
const OEC_SKIP_WRITE_SHEET = process.env.OEC_SKIP_WRITE_SHEET === '1';
const OEC_SHIFT_LABEL = process.env.OEC_SHIFT_LABEL || '';

// ====== 配置常量（从 monitor-utils 导入）======
const CAR_MODEL_DEFAULT = '贝塔S3';
const CAR_MODEL_OVERRIDE = {
  '2026-06-30': '问道V9',
};
function getCarModel() {
  const today = getLocalDate();
  return CAR_MODEL_OVERRIDE[today] || CAR_MODEL_DEFAULT;
}

const SHIFT_SPREADSHEET_TOKEN = SPREADSHEET_TOKEN;
const SHIFT_SHEET_ID = SHEET_ID;

// 读取当天班次：优先本地缓存，失败时实时从飞书表读
function readTodayShifts() {
  const today = getLocalDate();
  const cacheFile = path.join(DATA_DIR, 'shifts-' + today + '.json');
  try {
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (cached.shifts && cached.shifts.length > 0) {
        log('📋 从缓存读取 ' + cached.shifts.length + ' 个班次');
        return cached.shifts;
      }
    }
  } catch (e) {
    log('⚠ 读取班次缓存失败，尝试实时拉取: ' + e.message);
  }

  // 实时从飞书表读
  const larkCli = findLarkCli();
  if (!larkCli) throw new Error('lark-cli 未找到');
  const startRow = getShiftRowForDate(today);
  const count = getShiftsPerDay(today);
  const endRow = startRow + count - 1;
  const isExe = larkCli.endsWith('.exe');
  const out = execFileSync(
    isExe ? larkCli : 'cmd.exe',
    isExe
      ? ['sheets', '+csv-get', '--spreadsheet-token', SHIFT_SPREADSHEET_TOKEN, '--sheet-id', SHIFT_SHEET_ID, '--range', 'B' + startRow + ':B' + endRow]
      : ['/c', larkCli, 'sheets', '+csv-get', '--spreadsheet-token', SHIFT_SPREADSHEET_TOKEN, '--sheet-id', SHIFT_SHEET_ID, '--range', 'B' + startRow + ':B' + endRow],
    { encoding: 'utf-8', timeout: 20000, windowsHide: true, cwd: __dirname }
  );
  const parsed = JSON.parse(out);
  const csv = parsed?.data?.annotated_csv || '';
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length === 0) throw new Error('排班表为空');

  const shifts = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
    if (match) {
      const startTime = match[1] + ':' + match[2];
      const endTime = match[3] + ':' + match[4];
      const startH = parseInt(match[1]);
      const endH = parseInt(match[3]);
      const endM = parseInt(match[4]);
      const hours = [];
      for (let h = startH; h <= endH; h++) {
        if (h === endH && endM === 0) continue;
        hours.push(h);
      }
      shifts.push({ label: startTime + '-' + endTime, hours, row: startRow + i });
    }
  }
  if (shifts.length === 0) throw new Error('无法解析班次时间');
  log('📋 实时拉取 ' + shifts.length + ' 个班次');
  return shifts;
}

// ====== 防重放锁 ======
const LOCK_FILE = path.join(DATA_DIR, 'shift-push-lock.json');
const ERROR_LOG = path.join(DATA_DIR, 'shift-push-errors.log');

function log(...args) { console.log('[shift-pusher] ' + new Date().toLocaleString() + ' |', ...args); }
function logError(...args) {
  const line = '[' + new Date().toLocaleString() + '] ' + args.join(' ') + '\n';
  try { fs.appendFileSync(ERROR_LOG, line); } catch {}
  console.error('[shift-pusher] ERROR |', ...args);
}

function todayDateCN() {
  const d = new Date();
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

function isAlreadyPushed(shiftLabel) {
  try {
    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
    const today = getLocalDate();
    return lock.date === today && lock.shifts && lock.shifts.includes(shiftLabel);
  } catch { return false; }
}

function markPushed(shiftLabel) {
  try {
    const today = getLocalDate();
    let lock = { date: today, shifts: [] };
    try {
      const existing = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
      if (existing.date === today && Array.isArray(existing.shifts)) {
        lock = existing;
      }
    } catch {}
    if (!lock.shifts.includes(shiftLabel)) {
      lock.shifts.push(shiftLabel);
    }
    atomicWriteJSON(LOCK_FILE, lock);
  } catch (e) { logError('写 lock 文件失败:', e.message); }
}

function runLarkCli(args, timeoutMs = 20000) {
  const larkCli = findLarkCli();
  if (!larkCli) throw new Error('lark-cli 未找到');
  const isExe = larkCli.endsWith('.exe');
  const result = execFileSync(
    isExe ? larkCli : 'cmd.exe',
    isExe ? args : ['/c', larkCli, ...args],
    { encoding: 'utf-8', timeout: timeoutMs, windowsHide: true, cwd: __dirname }
  );
  return result;
}

function runLarkCliAsync(args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    try { resolve(runLarkCli(args, timeoutMs)); }
    catch (e) { reject(e); }
  });
}

async function withRetry(fn, label, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === maxRetries - 1) throw e;
      const delay = 5000 * Math.pow(2, i);
      log('⚠ ' + label + ' 第' + (i + 1) + '/' + maxRetries + '次失败，' + (delay / 1000) + 's后重试: ' + e.message);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ====== 核心流程 ======
async function runShift(shift) {
  const row = shift.row;
  log('▶ 开始处理时段: ' + shift.label + ' (行' + row + ', 小时' + shift.hours.join(',') + ')');

  if (!OEC_FORCE && isAlreadyPushed(shift.label)) {
    log('⏭ 已推送过 ' + shift.label + '，跳过');
    return;
  }

  // 班次结束后等待30秒，确保结束时刻的15分钟快照已写入磁盘，
  // 否则 getSnapshotAt 会回退取5分钟前的快照，导致该场次数据不完整
  if (!OEC_FORCE) {
    log('⏳ 班次已结束，等待30秒以确保结束快照完整...');
    await new Promise(r => setTimeout(r, 30_000));
  }

  let shiftData;
  try {
    const today = getLocalDate();
    const apiClient = await createClient({ useCache: true });
    shiftData = await withRetry(
      () => getShiftDelta(today, shift, { accountId: ACCOUNT_ID, apiClient }),
      shift.label + ' 数据拉取'
    );
  } catch (e) {
    logError('数据拉取失败 ' + shift.label + ' (已重试):', e.message);
    return;
  }

  let totalConsume = shiftData.spend;
  let totalLeads = shiftData.leads;
  let cpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';

  if (shiftData.fromCache) {
    log('📊 快照差值 ' + shift.label + ': 消耗¥' + totalConsume.toFixed(2) + ' 线索' + totalLeads + ' CPL¥' + cpl);
    if (shiftData.detail?.startSnapshot) {
      const startTag = shiftData.detail.startSource === '5m' ? '[5m]' : '';
      const endTag = shiftData.detail.endSource === '5m' ? '[5m]' : '';
      log('   ' + startTag + shiftData.detail.startSnapshot + ' → ' + endTag + shiftData.detail.endSnapshot);
      log('   开始: ¥' + shiftData.detail.startSpend + ' / ' + shiftData.detail.startLeads + '线索 → 结束: ¥' + shiftData.detail.endSpend + ' / ' + shiftData.detail.endLeads + '线索');
    }
  } else {
    log('📊 API兜底 ' + shift.label + ': 消耗¥' + totalConsume.toFixed(2) + ' 线索' + totalLeads + ' CPL¥' + cpl);
    log('   原因: ' + (shiftData.detail?.reason || '未知'));

    // 首场特判：无开始快照时，用最近 5m 快照的 accountSpend 作为时段总消耗
    const reason = shiftData.detail?.reason || '';
    if (reason.includes('startSnapshot')) {
      try {
        // 找最接近班次结束时间(Beijing)的 5m 快照
        const endTime = shift.label.split('-')[1]; // e.g. "07:30"
        const [eh, em] = endTime.split(':').map(Number);
        const endMin = eh * 60 + em;
        const files = fs.readdirSync(DATA_DIR)
          .filter(f => f.startsWith('5m-') && f.endsWith('.json'))
          .sort();

        let bestFile = null, bestDiff = Infinity, bestHH = '', bestMM = '';
        for (const f of files) {
          const m = f.match(/T(\d{2})-(\d{2})/);
          if (!m) continue;
          const fh = parseInt(m[1]), fm = parseInt(m[2]);
          const fMin = fh * 60 + fm;
          const diff = Math.abs(fMin - endMin);
          if (diff < bestDiff) { bestDiff = diff; bestFile = f; bestHH = m[1]; bestMM = m[2]; }
        }
        if (bestFile && bestDiff <= 30) {
          const snap = JSON.parse(fs.readFileSync(path.join(DATA_DIR, bestFile), 'utf-8'));
          const correctedSpend = snap.accountSpend || 0;
          if (correctedSpend > 0) {
            log('  🔧 首场修正(' + bestHH + ':' + bestMM + '): accountSpend ¥' + correctedSpend.toFixed(2) + ' (原API值 ¥' + totalConsume.toFixed(2) + ')');
            totalConsume = correctedSpend;
            const correctedLeads = snap.totalConv || totalLeads;
            totalLeads = correctedLeads;
            cpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';
          }
        }
      } catch {}
    }
  }

  if (totalConsume <= 0) {
    log('⏭ 消耗为0，跳过 ' + shift.label);
    return;
  }

  if (OEC_DRY_RUN) {
    log('🧪 OEC_DRY_RUN=1，不写入表格/不推送');
    return;
  }

  if (OEC_SKIP_WRITE_SHEET) {
    log('⏭ OEC_SKIP_WRITE_SHEET=1，跳过写表');
  } else {
    try {
      const cells = JSON.stringify([[
        { value: Math.round(totalConsume * 100) / 100 },
        { value: totalLeads },
        { value: totalLeads > 0 ? Math.round((totalConsume / totalLeads) * 100) / 100 : 0 },
      ]]);
      await withRetry(
        () => runLarkCliAsync([
          'sheets', '+cells-set',
          '--spreadsheet-token', SPREADSHEET_TOKEN,
          '--sheet-id', SHEET_ID,
          '--range', 'D' + row + ':F' + row,
          '--cells', cells,
        ]),
        shift.label + ' 写表'
      );
      log('✅ 已写表 D' + row + ':F' + row);
    } catch (e) {
      logError('写飞书表失败 ' + shift.label + ' (已重试):', e.message);
    }
  }

  let anchorName = '未知';
  try {
    const csvOut = runLarkCli([
      'sheets', '+csv-get',
      '--spreadsheet-token', SPREADSHEET_TOKEN,
      '--sheet-id', SHEET_ID,
      '--range', 'A' + row + ':C' + row,
    ]);
    const parsed = JSON.parse(csvOut);
    const annotated = parsed?.data?.annotated_csv || '';
    const cols = annotated.split(',');
    if (cols.length >= 3) anchorName = cols[2].trim();
    log('👤 主播: ' + anchorName);
  } catch (e) {
    logError('读主播名失败 ' + shift.label + ':', e.message);
  }

  try {
    const msgText = todayDateCN() + ' ' + shift.label + '\n主播：' + anchorName + '（车型：' + getCarModel() + '）\n真人直播消耗：' + totalConsume.toFixed(2) + '\n直播广告线索数：' + totalLeads + '\n直播CPL：' + cpl;
    await withRetry(
      () => runLarkCliAsync([
        'im', '+messages-send',
        '--chat-id', SHIFT_CHAT_ID,
        '--text', msgText,
        '--as', 'bot',
      ]),
      shift.label + ' 推群'
    );
    log('✅ 已推送飞书群: ' + shift.label + ' | ' + anchorName + ' | ¥' + totalConsume.toFixed(2));
  } catch (e) {
    logError('推飞书群失败 ' + shift.label + ' (已重试):', e.message);
    return;
  }

  markPushed(shift.label);
  log('✓ 时段 ' + shift.label + ' 处理完成');

  // 检测是否为当天最后一场，触发日终任务
  await triggerEndOfDayTasks(shift);
}

// ====== 日终任务触发 ======
const _eodTriggered = new Set();

async function triggerEndOfDayTasks(shift) {
  const today = getLocalDate();
  if (_eodTriggered.has(today)) return;

  const sorted = [..._todayShifts].sort((a, b) => getShiftEndMinutes(b) - getShiftEndMinutes(a));
  if (sorted.length === 0) return;
  if (shift.label !== sorted[0].label) return;

  _eodTriggered.add(today);
  log('[EOD] 最后一场 ' + shift.label + ' 结束，触发日终任务...');

  const nodeExe = process.execPath;
  const cwd = __dirname;
  // sync-tomorrow 立即执行，数据任务等待4分钟（广告后台数据延迟）
  const DATA_DELAY = 4 * 60_000;
  const tasks = [
    { name: 'sync-tomorrow', script: 'sync-tomorrow-shifts.mjs', delay: 0 },
    { name: 'daily-report', script: 'oceanengine-daily-report-scheduler.mjs', delay: DATA_DELAY },
    { name: 'daily-summary', script: 'oceanengine-daily-summary.mjs', delay: DATA_DELAY + 30_000 },
    { name: 'ai-regions', script: 'ai-regions-http.mjs', delay: DATA_DELAY + 60_000 },
  ];

  for (const task of tasks) {
    setTimeout(() => {
      log('[EOD] 触发: ' + task.name + ' (' + task.script + ')');
      const child = spawn(nodeExe, [path.join(cwd, task.script)], {
        cwd, stdio: 'ignore', detached: true,
        env: { ...process.env, OEC_SILENT: '1' },
      });
      child.unref();
    }, task.delay);
  }
}

// ====== 班次结束检测 ======
function getShiftEndMinutes(shift) {
  const m = shift.label.match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
  if (!m) return -1;
  return parseInt(m[3]) * 60 + parseInt(m[4]);
}

function isShiftEnded(shift, now) {
  const endMin = getShiftEndMinutes(shift);
  if (endMin < 0) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= endMin && nowMin <= endMin + 30;
}

// ====== 动态轮询调度 ======
let _todayShifts = [];
let _todayShiftsDate = '';
let _todayShiftsMtime = 0;
let _lastProcessedShifts = new Set();

function ensureTodayShifts() {
  const today = getLocalDate();
  const cacheFile = path.join(DATA_DIR, 'shifts-' + today + '.json');

  let mtime = 0;
  try { mtime = fs.statSync(cacheFile).mtimeMs; } catch {}

  if (_todayShiftsDate === today && _todayShifts.length > 0 && mtime <= _todayShiftsMtime) {
    return;
  }

  const prevHash = _todayShifts.map(s => s.label).join(',');
  _todayShifts = readTodayShifts();
  _todayShiftsDate = today;
  _todayShiftsMtime = mtime;

  log('📅 今天 ' + _todayShifts.length + ' 个班次:');
  _todayShifts.forEach(s => log('   ' + s.label + ' -> 行' + s.row + ' 小时[' + s.hours.join(',') + ']'));

  const newHash = _todayShifts.map(s => s.label).join(',');
  if (prevHash && prevHash !== newHash) {
    log('⚠ 排班表已更新（mid-day 变更），旧: ' + prevHash.substring(0, 60) + '... → 新: ' + newHash.substring(0, 60) + '...');
    _lastProcessedShifts = new Set();
  }
}

async function pollOnce() {
  const now = new Date();
  ensureTodayShifts();

  for (const shift of _todayShifts) {
    if (isShiftEnded(shift, now)) {
      if (isAlreadyPushed(shift.label)) continue;
      if (_lastProcessedShifts.has(shift.label) && !OEC_FORCE) continue;
      _lastProcessedShifts.add(shift.label);
      try { await runShift(shift); }
      catch (e) { logError('未捕获异常 ' + shift.label + ':', e.message, e.stack); }
    }
  }
}

function startPolling() {
  log('🚀 换班推送守护进程启动 (动态轮询模式)');
  ensureTodayShifts();
  log('⏰ 轮询模式已启动，每60秒检测班次结束...');

  pollOnce().catch(e => logError('轮询异常:', e.message));

  setInterval(() => {
    pollOnce().catch(e => logError('轮询异常:', e.message));
  }, 60 * 1000);
}

// ====== 入口 ======
async function main() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

  if (OEC_FORCE) {
    ensureTodayShifts();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let bestShift = null;
    if (OEC_SHIFT_LABEL) {
      bestShift = _todayShifts.find(s => s.label === OEC_SHIFT_LABEL);
      if (!bestShift) {
        log('🔧 OEC_SHIFT_LABEL=' + OEC_SHIFT_LABEL + ' 未找到匹配班次，可用: ' + _todayShifts.map(s => s.label).join(', '));
        return;
      }
      log('🔧 OEC_FORCE=1 + OEC_SHIFT_LABEL，强制执行: ' + bestShift.label);
    } else {
      let bestEndMin = -1;
      for (const s of _todayShifts) {
        const endMin = getShiftEndMinutes(s);
        if (endMin >= 0 && endMin <= nowMin && endMin > bestEndMin) {
          bestEndMin = endMin;
          bestShift = s;
        }
      }
      if (!bestShift) {
        bestShift = _todayShifts[0];
        log('🔧 OEC_FORCE=1，当前无已结束班次，执行第一个班次: ' + bestShift.label);
      } else {
        log('🔧 OEC_FORCE=1，强制执行最近结束的班次: ' + bestShift.label);
      }
    }
    await runShift(bestShift);
    return;
  }

  startPolling();
}

main().catch(e => {
  logError('FATAL:', e.message, e.stack);
  process.exit(1);
});
