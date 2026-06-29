// monitor-utils.mjs — 共享工具模块 (v3.2 配置中心化 2026-06-29)
// 供 monitor-v3 / daily-report-scheduler / feedback-server / daily-report / ai-regions 共用
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ====== .env 加载（轻量实现，统一配置入口，避免 dotenv 依赖） ======
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// ====== 静默模式 (OEC_SILENT=1 时抑制所有控制台输出) ======
const IS_SILENT = process.env.OEC_SILENT === '1';
if (IS_SILENT) {
  const noop = () => {};
  const LOG_FILE = path.join(__dirname, 'monitor-data', 'monitor.log');
  const toFile = (...args) => {
    const line = `[${new Date().toLocaleString()}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`;
    try { fs.appendFileSync(LOG_FILE, line); } catch {}
  };
  console.log = toFile;
  console.warn = toFile;
  console.error = toFile;
  console.info = toFile;
  // 保持 process.stdout/stderr 静默
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = noop;
  process.stderr.write = noop;
}

// ====== 共享路径常量 ======
export const DATA_DIR = path.join(__dirname, 'monitor-data');
export const REPORT_DIR = __dirname;
export const HISTORY_FILE = path.join(DATA_DIR, 'suggestion-history.json');
// ====== 业务配置（优先读环境变量，回退默认值） ======
export const FEISHU_CHAT_ID = process.env.LARK_MONITOR_CHAT_ID || 'oc_8deeb3061bdbd43608de252a44c97a25';
export const FEISHU_ANCHOR_CHAT_ID = process.env.LARK_ANCHOR_CHAT_ID || 'oc_b245ee4b255c7b25b7f8d953802c49ff';
export const ACCOUNT_NAME = '极狐-区域福利号-直播';
export const ACCOUNT_ID = process.env.OEC_ACCOUNT_ID || '1842681352509635';
export const CAMPAIGN_URL = `https://ad.oceanengine.com/promotion/promote-manage/project?aadvid=${ACCOUNT_ID}`;
export const DAILY_BUDGET = 45000;
export const DAILY_START_HOUR = 7;
export const DAILY_END_HOUR = 23;

// ====== AI区域号账户配置（从 oceanengine-ai-regions.mjs 抽出，统一管理） ======
export const AI_REGIONS = [
  { name: '东区', aadvid: '1842681994872135', reportId: '299497419' },
  { name: '西区', aadvid: '1842681830951944', reportId: '299491275' },
  { name: '中区', aadvid: '1842663909080452', reportId: '298926513' },
  { name: '南区', aadvid: '1842682454270468', reportId: '299530471' },
  { name: '北区', aadvid: '1842683071403332', reportId: '299540674' },
];

// ====== 基础设施端口（统一管理，避免散落） ======
export const CDP_PORT = 9222;
export const CDP_PROXY_PORT = 3456;   // ai-regions 仍依赖，待后续迁移
export const CDP_PROXY_URL = `http://localhost:${CDP_PROXY_PORT}`;
export const FEEDBACK_PORT = 8899;

// ====== 浏览器配置 ======
// Chrome User Data 目录（Chrome149要求CDP使用非默认目录，故用D盘独立副本）
// 主数据: C:\Users\HTF2026\AppData\Local\Google\Chrome\User Data (日常使用)
// CDP副本: D:\ChromeCDP\User Data (监控专用，自动脚本同步)
export const CHROME_USER_DATA_DIR = 'D:\\ChromeCDP\\User Data';
// 默认使用 Profile 4（小七身份）
export const CHROME_PROFILE_DIRECTORY = 'Profile 4';
// Chrome 安装路径搜索列表（D盘Chrome）
export const CHROME_PATHS = [
  'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  (process.env.LOCALAPPDATA || 'C:\\Users\\HTF2026\\AppData\\Local') + '\\Google\\Chrome\\Application\\chrome.exe',
];
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

export async function guardFeedbackServer() {
  const alive = await checkFeedbackServer();
  if (alive) return true;
  console.log('  📡 反馈服务器未运行，尝试启动...');
  try {
    const serverScript = path.join(__dirname, 'feedback-server.mjs');
    const child = spawn(process.execPath, [serverScript], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await checkFeedbackServer()) {
        console.log('  📡 反馈服务器启动成功');
        return true;
      }
    }
    console.log('  ⚠ 反馈服务器启动超时');
    return false;
  } catch (e) {
    console.log(`  ⚠ 反馈服务器启动失败: ${e.message}`);
    return false;
  }
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
