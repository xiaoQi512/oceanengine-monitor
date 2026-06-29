// oceanengine-shift-pusher.mjs — 主播换班数据推送常驻守护脚本
// 由 PM2 托管，node-cron 内置 8 时段调度，HTTP API 拉数据 → 写飞书表 → 推飞书群
//
// 环境变量：
//   OEC_SILENT=1   静默模式（console.* 重定向到日志文件，由 monitor-utils 处理）
//   OEC_FORCE=1    强制触发当前时段（测试用，跳过 cron 等待）
//   OEC_DRY_RUN=1  只拉数据不推送（验证数据源）
//
// 用法：
//   常驻: pm2 start ecosystem.config.cjs
//   测试: OEC_FORCE=1 OEC_DRY_RUN=1 node oceanengine-shift-pusher.mjs
//   手推: OEC_FORCE=1 node oceanengine-shift-pusher.mjs

import cron from 'node-cron';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient, getHourlyStats } from './oceanengine-api-client.mjs';
import {
  findLarkCli, DATA_DIR, getLocalDate, atomicWriteJSON,
} from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OEC_FORCE = process.env.OEC_FORCE === '1';
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === '1';

// ====== 配置常量 ======
const SPREADSHEET_TOKEN = 'GiNOslsWQhyHDPtclPscns3GnAf';
const SHEET_ID = 'j69tpS';
const SHIFT_CHAT_ID = 'oc_b245ee4b255c7b25b7f8d953802c49ff';
const ACCOUNT_ID = '1842681352509635';
const CAR_MODEL = '贝塔T1';

// 6月26日 = row 200，每天 8 行。row = 200 + (当天 - 6月26日) * 8
const BASE_DATE = new Date(2026, 5, 26); // 月份从0开始，5=6月
const BASE_ROW = 200;

function getShiftRowForToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - BASE_DATE) / (24 * 60 * 60 * 1000));
  return BASE_ROW + diffDays * 8;
}

// 8 个换班时段（row 在运行时动态计算）
const SHIFTS = [
  { trigger: '5 9 * * *',  hours: [7, 8],   label: '07:00-09:00' },
  { trigger: '5 11 * * *', hours: [9, 10],  label: '09:00-11:00' },
  { trigger: '5 13 * * *', hours: [11, 12], label: '11:00-13:00' },
  { trigger: '5 15 * * *', hours: [13, 14], label: '13:00-15:00' },
  { trigger: '5 17 * * *', hours: [15, 16], label: '15:00-17:00' },
  { trigger: '5 19 * * *', hours: [17, 18], label: '17:00-19:00' },
  { trigger: '5 21 * * *', hours: [19, 20], label: '19:00-21:00' },
  { trigger: '5 23 * * *', hours: [21, 22], label: '21:00-23:00' },
];

// 动态注入 row（每天 BASE_ROW + 天数差 * 8 + 时段索引）
function getShiftsWithRows() {
  const baseRow = getShiftRowForToday();
  return SHIFTS.map((s, i) => ({ ...s, row: baseRow + i }));
}

const LOCK_FILE = path.join(DATA_DIR, 'shift-push-lock.json');
const ERROR_LOG = path.join(DATA_DIR, 'shift-push-errors.log');

// ====== 工具函数 ======
function log(...args) { console.log(`[shift-pusher] ${new Date().toLocaleString()} |`, ...args); }
function logError(...args) {
  const line = `[${new Date().toLocaleString()}] ${args.join(' ')}\n`;
  try { fs.appendFileSync(ERROR_LOG, line); } catch {}
  console.error(`[shift-pusher] ERROR |`, ...args);
}

function todayDateCN() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// 防重放检查：同一天同时段只推一次
function isAlreadyPushed(shiftLabel) {
  try {
    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
    const today = getLocalDate();
    return lock.date === today && lock.shift === shiftLabel;
  } catch { return false; }
}

function markPushed(shiftLabel) {
  try {
    atomicWriteJSON(LOCK_FILE, {
      date: getLocalDate(),
      shift: shiftLabel,
      pushedAt: new Date().toISOString(),
    });
  } catch (e) { logError('写 lock 文件失败:', e.message); }
}

// 执行 lark-cli 命令（同步，带超时）
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

// runLarkCli 的异步 Promise 包装（供 withRetry 使用）
function runLarkCliAsync(args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    try { resolve(runLarkCli(args, timeoutMs)); }
    catch (e) { reject(e); }
  });
}

// 指数退避重试：5s / 10s / 20s
async function withRetry(fn, label, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === maxRetries - 1) throw e;
      const delay = 5000 * Math.pow(2, i);
      log(`⚠ ${label} 第${i + 1}/${maxRetries}次失败，${delay / 1000}s后重试: ${e.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ====== 核心流程 ======
async function runShift(shift, shiftIndex) {
  const row = getShiftRowForToday() + shiftIndex;
  log(`▶ 开始处理时段: ${shift.label} (行${row}, 小时${shift.hours.join(',')})`);

  // 1. 防重放
  if (!OEC_FORCE && isAlreadyPushed(shift.label)) {
    log(`⏭ 已推送过 ${shift.label}，跳过`);
    return;
  }

  // 2. HTTP API 拉取目标 2 小时数据（3次指数退避重试）
  let apiData;
  try {
    const client = await createClient({ useCache: true });
    const [h1, h2] = shift.hours;
    const result = await withRetry(
      () => getHourlyStats(client, { accountId: ACCOUNT_ID, startHour: h1, endHour: h2 }),
      `${shift.label} API拉取`
    );
    if (!result.rows || result.rows.length === 0) {
      log(`⚠ API 返回空数据，跳过 ${shift.label}`);
      return;
    }
    apiData = result;
  } catch (e) {
    logError(`API 拉取失败 ${shift.label} (已重试):`, e.message);
    return;
  }

  // 3. 汇总消耗/线索
  let totalConsume = 0, totalLeads = 0;
  const hourDetails = [];
  for (const row of apiData.rows) {
    // 只统计 hours 数组内的小时（API 的 endHour+1 可能多返回一行）
    const rowHour = parseInt(row.hour?.match(/(\d{2}):00/)?.[1] ?? -1);
    if (!shift.hours.includes(rowHour)) continue;
    const costStr = (row.metrics?.stat_cost?.valueStr || '0').replace(/,/g, '');
    const leadsStr = (row.metrics?.convert_cnt?.valueStr || '0').replace(/,/g, '');
    const cost = parseFloat(costStr) || 0;
    const leads = parseInt(leadsStr) || 0;
    totalConsume += cost;
    totalLeads += leads;
    hourDetails.push({ hour: row.hour, cost, leads });
  }
  const cpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';

  log(`📊 数据汇总 ${shift.label}: 消耗¥${totalConsume.toFixed(2)} 线索${totalLeads} CPL¥${cpl}`);
  hourDetails.forEach(h => log(`   ${h.hour}: ¥${h.cost.toFixed(2)} / ${h.leads}线索`));

  // 4. 消耗为0 → 跳过
  if (totalConsume <= 0) {
    log(`⏭ 消耗为0，跳过 ${shift.label}`);
    return;
  }

  // DRY_RUN 模式到此为止
  if (OEC_DRY_RUN) {
    log(`🧪 OEC_DRY_RUN=1，不写入表格/不推送`);
    return;
  }

  // 5. 写入飞书表格 D/E/F 列（3次重试）
  try {
    const cells = JSON.stringify([[{ value: totalConsume.toFixed(2) }, { value: String(totalLeads) }, { value: cpl }]]);
    await withRetry(
      () => runLarkCliAsync([
        'sheets', '+cells-set',
        '--spreadsheet-token', SPREADSHEET_TOKEN,
        '--sheet-id', SHEET_ID,
        '--range', `D${row}:F${row}`,
        '--cells', cells,
      ]),
      `${shift.label} 写表`
    );
    log(`✅ 已写表 D${row}:F${row}`);
  } catch (e) {
    logError(`写飞书表失败 ${shift.label} (已重试):`, e.message);
    // 写表失败不阻断推送，继续推群消息
  }

  // 6. 读取主播名（C 列）
  let anchorName = '未知';
  try {
    const csvOut = runLarkCli([
      'sheets', '+csv-get',
      '--spreadsheet-token', SPREADSHEET_TOKEN,
      '--sheet-id', SHEET_ID,
      '--range', `A${row}:C${row}`,
    ]);
    const parsed = JSON.parse(csvOut);
    // annotated_csv 格式: "[row=N] 6月26日,15:00-17:00,张萌"
    const annotated = parsed?.data?.annotated_csv || '';
    const cols = annotated.split(',');
    if (cols.length >= 3) anchorName = cols[2].trim();
    log(`👤 主播: ${anchorName}`);
  } catch (e) {
    logError(`读主播名失败 ${shift.label}:`, e.message);
  }

  // 7. 推送飞书群（3次重试）
  try {
    const msgText = `${todayDateCN()} ${shift.label}\n主播：${anchorName}（车型：${CAR_MODEL}）\n真人直播消耗：${totalConsume.toFixed(2)}\n直播广告线索数：${totalLeads}\n直播CPL：${cpl}`;
    await withRetry(
      () => runLarkCliAsync([
        'im', '+messages-send',
        '--chat-id', SHIFT_CHAT_ID,
        '--text', msgText,
        '--as', 'bot',
      ]),
      `${shift.label} 推群`
    );
    log(`✅ 已推送飞书群: ${shift.label} | ${anchorName} | ¥${totalConsume.toFixed(2)}`);
  } catch (e) {
    logError(`推飞书群失败 ${shift.label} (已重试):`, e.message);
    return; // 推送失败不标记 lock
  }

  // 8. 更新防重放锁
  markPushed(shift.label);
  log(`✓ 时段 ${shift.label} 处理完成`);
}

// ====== 调度注册 ======
function startScheduler() {
  log('🚀 换班推送守护进程启动');
  log(`📅 注册 ${SHIFTS.length} 个 cron 任务 (时区 Asia/Shanghai):`);
  const baseRow = getShiftRowForToday();
  SHIFTS.forEach((s, i) => log(`   ${s.trigger} → ${s.label} (行${baseRow + i})`));

  for (let i = 0; i < SHIFTS.length; i++) {
    const shift = SHIFTS[i];
    const shiftIndex = i;
    cron.schedule(shift.trigger, async () => {
      try { await runShift(shift, shiftIndex); }
      catch (e) { logError(`未捕获异常 ${shift.label}:`, e.message, e.stack); }
    }, { timezone: 'Asia/Shanghai' });
  }

  log('⏰ 等待下一次触发...');
}

// ====== 入口 ======
async function main() {
  // 确保 DATA_DIR 存在
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

  if (OEC_FORCE) {
    // 强制模式：找当前时间对应的时段执行一次
    const now = new Date();
    const hour = now.getHours();
    const shiftIdx = SHIFTS.findIndex(s => s.hours.includes(hour - 1) || s.hours.includes(hour - 2));
    if (shiftIdx >= 0) {
      const shift = SHIFTS[shiftIdx];
      log(`🔧 OEC_FORCE=1，强制执行时段: ${shift.label}`);
      await runShift(shift, shiftIdx);
    } else {
      // 找不到匹配时段，执行最近的一个
      const nearestIdx = SHIFTS.findIndex(s => s.hours[1] < hour);
      const idx = nearestIdx >= 0 ? nearestIdx : SHIFTS.length - 1;
      const nearest = SHIFTS[idx];
      log(`🔧 OEC_FORCE=1，当前小时${hour}无精确匹配，执行最近时段: ${nearest.label}`);
      await runShift(nearest, idx);
    }
    return;
  }

  startScheduler();
}

main().catch(e => {
  logError('FATAL:', e.message, e.stack);
  process.exit(1);
});
