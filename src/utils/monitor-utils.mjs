// monitor-utils.mjs — 共享工具模块 (v3.2 配置中心化 2026-06-29)
// 供 monitor-v3 / daily-report-scheduler / feedback-server / daily-report / ai-regions 共用
import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync, spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import { installConsoleInterceptor } from './logger.mjs';
import {
  PROJECT_ROOT,
  DATA_DIR,
  REPORT_DIR,
  ACTION_QUEUE_FILE,
  ACTION_LOCK_FILE,
  ACTION_AUDIT_FILE,
  ACTION_PENDING_FILE,
  HISTORY_FILE,
  FEISHU_CHAT_ID,
  FEISHU_ANCHOR_CHAT_ID,
  BOT_APP_ID,
  ACCOUNT_NAME,
  ACCOUNT_ID,
  VIDEO_ACCOUNT_ID,
  CAMPAIGN_URL,
  DAILY_BUDGET,
  DAILY_START_HOUR,
  DAILY_END_HOUR,
  SHIFT_SPREADSHEET_TOKEN,
  SHIFT_SHEET_ID,
  SHIFT_BASE_DATE,
  SHIFT_BASE_ROW,
  AI_REGIONS,
  CDP_PORT,
  CDP_PROXY_PORT,
  CDP_PROXY_URL,
  FEEDBACK_PORT,
  CHROME_USER_DATA_DIR,
  CHROME_PROFILE_DIRECTORY,
  CHROME_PATHS,
} from '../config/index.mjs';

// 统一日志聚合（src/config 加载 .env 后由本模块确认安装）
installConsoleInterceptor();

/** 初始化 pending 文件（如果不存在） */
export function initPendingFile() {
  const PENDING_FILE = ACTION_PENDING_FILE;
  if (!fs.existsSync(PENDING_FILE)) {
    fs.writeFileSync(PENDING_FILE, JSON.stringify({ pending: [] }, null, 2), 'utf-8');
  }
}
let _shiftWindowCache = null;
let _shiftWindowCacheDate = '';

export function getShiftsPerDay(dateStr) {
  // 9 场制日期（含 21:30-23:30 晚班）
  const NINE_SHIFT_DATES = ['2026-07-08','2026-07-09','2026-07-10','2026-08-01'];
  if (NINE_SHIFT_DATES.includes(dateStr)) return 9;
  return 8;
}

export function getShiftRowForDate(dateStr) {
  const target = new Date(dateStr + 'T00:00:00+08:00');
  let row = SHIFT_BASE_ROW;
  const d = new Date(SHIFT_BASE_DATE);
  while (d < target) {
    row += getShiftsPerDay(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return row;
}

export function getTodayShiftWindow() {
  const today = getLocalDate();
  if (_shiftWindowCacheDate === today && _shiftWindowCache) return _shiftWindowCache;

  // 优先读取本地缓存
  try {
    const cacheFile = path.join(DATA_DIR, `shifts-${today}.json`);
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (cached.startHour != null && cached.endHour != null) {
        const result = {
          startHour: cached.startHour,
          startMinute: cached.startMinute || 0,
          endHour: cached.endHour,
          endMinute: cached.endMinute || 0,
        };
        _shiftWindowCache = result;
        _shiftWindowCacheDate = today;
        return result;
      }
    }
  } catch {}

  try {
    const larkCli = findLarkCli();
    if (!larkCli) throw new Error('lark-cli not found');
    const startRow = getShiftRowForDate(getLocalDate());
    const count = getShiftsPerDay(today);
    const endRow = startRow + count - 1;
    const range = 'B' + startRow + ':' + endRow;
    const out = execFileSync(
      larkCli.endsWith('.exe') ? larkCli : 'cmd.exe',
      larkCli.endsWith('.exe')
        ? ['sheets', '+csv-get', '--spreadsheet-token', SHIFT_SPREADSHEET_TOKEN, '--sheet-id', SHIFT_SHEET_ID, '--range', range]
        : ['/c', larkCli, 'sheets', '+csv-get', '--spreadsheet-token', SHIFT_SPREADSHEET_TOKEN, '--sheet-id', SHIFT_SHEET_ID, '--range', range],
      { encoding: 'utf-8', timeout: 10000, windowsHide: true, cwd: PROJECT_ROOT }
    );
    const parsed = JSON.parse(out);
    const csv = parsed?.data?.annotated_csv || '';
    const lines = csv.split(/\n/).filter(l => l.trim());
    const firstMatch = lines[0]?.match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
    const lastMatch = lines[lines.length - 1]?.match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
    if (!firstMatch || !lastMatch) throw new Error('parse failed');
    const result = {
      startHour: parseInt(firstMatch[1]),
      startMinute: parseInt(firstMatch[2]),
      endHour: parseInt(lastMatch[3]),
      endMinute: parseInt(lastMatch[4]),
    };
    _shiftWindowCache = result;
    _shiftWindowCacheDate = today;
    return result;
  } catch {
    return { startHour: DAILY_START_HOUR, startMinute: 0, endHour: DAILY_END_HOUR, endMinute: 0 };
  }
}

// ====== 直播窗口文案：从排班表读取起止时间，生成统一显示标签 ======
// 返回 { durationHours, startTime, endTime, label, labelCompact }
// 示例: { durationHours: 17, startTime: '06:30', endTime: '23:30', label: '17h直播(06:30-23:30)', labelCompact: '17h直播(6-23)' }
export function getLiveWindowLabel() {
  const win = getTodayShiftWindow();
  const startH = win.startHour;
  const startM = win.startMinute || 0;
  const endH = win.endHour;
  const endM = win.endMinute || 0;
  const duration = endH - startH + (endM - startM) / 60;
  const pad = (n) => String(n).padStart(2, '0');
  return {
    durationHours: duration,
    startTime: pad(startH) + ':' + pad(startM),
    endTime: pad(endH) + ':' + pad(endM),
    label: duration + 'h直播(' + pad(startH) + ':' + pad(startM) + '-' + pad(endH) + ':' + pad(endM) + ')',
    labelCompact: duration + 'h直播(' + startH + '-' + endH + ')',
  };
}

// ====== 根据当前时间获取排班表中的主播名 ======
// 从本地缓存 shifts-YYYY-MM-DD.json 读取，匹配当前时间所在的班次
// 返回 string | null（无缓存或无匹配班次时返回 null）
export function getCurrentAnchorName() {
  const today = getLocalDate();
  try {
    const cacheFile = path.join(DATA_DIR, `shifts-${today}.json`);
    if (!fs.existsSync(cacheFile)) return null;
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    if (!cached.shifts || cached.shifts.length === 0) return null;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    for (const s of cached.shifts) {
      const match = s.label.match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
      if (!match) continue;
      const startMin = parseInt(match[1]) * 60 + parseInt(match[2]);
      const endMin = parseInt(match[3]) * 60 + parseInt(match[4]);
      if (nowMinutes >= startMin && nowMinutes < endMin) {
        return s.anchorName || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function findChromeExe() {
  for (const p of CHROME_PATHS) { if (fs.existsSync(p)) return p; }
  return '';
}

// ====== getLocalDate — 中国本地日期 YYYY-MM-DD ======
export function getLocalDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ====== minutesBetween — 两个时间戳之间的真实经过分钟数 ======
export function minutesBetween(a, b) {
  return Math.max((new Date(b).getTime() - new Date(a).getTime()) / 60000, 1);
}

// ====== findLarkCli — 按优先级查找 lark-cli 可执行文件 ======
export function findLarkCli() {
  const home = process.env.HOME || process.env.USERPROFILE || 'C:/Users/HTF2026';
  const larkPkgDir = path.join(home, '.workbuddy/binaries/node/cli-connector-packages');
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules/@larksuite/cli/bin/lark-cli.exe'),
    path.join(larkPkgDir, 'node_modules/@larksuite/cli/bin/lark-cli.exe'),
    path.join(larkPkgDir, 'lark-cli.cmd'),
    path.join(larkPkgDir, 'lark-cli'),
    'lark-cli',
    'lark-cli.cmd',
  ];
  // 重试机制：解决并发启动时 spawnSync 偶发失败
  for (let retry = 0; retry < 2; retry++) {
    for (const c of candidates) {
      try {
        if (c.endsWith('.exe')) {
          // 先检查文件是否存在
          if (!fs.existsSync(c)) continue;
          const r = spawnSync(c, ['--version'], { timeout: 5000, encoding: 'utf-8', windowsHide: true });
          if (r.status === 0 && r.stdout?.includes('lark-cli')) return c;
        } else {
          execSync(`"${c}" --version`, { stdio: 'pipe', timeout: 5000 });
          return c;
        }
      } catch {}
    }
    if (retry < 1) { /* 短暂等待后重试 */ }
  }
  return '';
}

// ====== 反馈服务器守护 ======
export function checkFeedbackServer() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${FEEDBACK_PORT}/health`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data.includes('"ok":true')));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// 反馈服务器已停用 (2026-07-14)，不再自动启动
export async function guardFeedbackServer() {
  return true;
}

// ====== 建议历史读写（原子写入，防并发损坏） ======
export function loadSuggestionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch {}
  return { suggestions: [], summary: { totalSuggestions: 0, accepted: 0, rejected: 0, ignored: 0, byType: {} } };
}

export function saveSuggestionHistory(history) {
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // 原子写入：先写临时文件再改名，防止写一半崩溃损坏
  const tmpFile = HISTORY_FILE + '.tmp';
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(history, null, 2));
    fs.renameSync(tmpFile, HISTORY_FILE);
  } catch {
    // 如果 rename 失败，尝试直接覆盖写入
    try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2)); } catch {}
  }
}

// ====== 建议汇总重算 ======
export function recalcSummary(history) {
  const summary = { totalSuggestions: 0, accepted: 0, rejected: 0, ignored: 0, byType: {} };
  for (const s of history.suggestions) {
    summary.totalSuggestions++;
    if (s.response === 'accept') summary.accepted++;
    else if (s.response === 'reject') summary.rejected++;
    else summary.ignored++;

    if (!summary.byType[s.alertType]) {
      summary.byType[s.alertType] = { total: 0, accepted: 0, rejected: 0, ignored: 0 };
    }
    summary.byType[s.alertType].total++;
    if (s.response === 'accept') summary.byType[s.alertType].accepted++;
    else if (s.response === 'reject') summary.byType[s.alertType].rejected++;
    else summary.byType[s.alertType].ignored++;
  }
  history.summary = summary;
}

// ====== 原子写入 daily JSON（防写一半崩溃损坏） ======
export function atomicWriteJSON(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpFile = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, filePath);
    return true;
  } catch {
    try { fs.unlinkSync(tmpFile); } catch {}
    return false;
  }
}

export {
  PROJECT_ROOT,
  DATA_DIR,
  REPORT_DIR,
  ACTION_QUEUE_FILE,
  ACTION_LOCK_FILE,
  ACTION_AUDIT_FILE,
  ACTION_PENDING_FILE,
  HISTORY_FILE,
  FEISHU_CHAT_ID,
  FEISHU_ANCHOR_CHAT_ID,
  BOT_APP_ID,
  ACCOUNT_NAME,
  ACCOUNT_ID,
  VIDEO_ACCOUNT_ID,
  CAMPAIGN_URL,
  DAILY_BUDGET,
  DAILY_START_HOUR,
  DAILY_END_HOUR,
  SHIFT_SPREADSHEET_TOKEN,
  SHIFT_SHEET_ID,
  SHIFT_BASE_DATE,
  SHIFT_BASE_ROW,
  AI_REGIONS,
  CDP_PORT,
  CDP_PROXY_PORT,
  CDP_PROXY_URL,
  FEEDBACK_PORT,
  CHROME_USER_DATA_DIR,
  CHROME_PROFILE_DIRECTORY,
  CHROME_PATHS,
};
