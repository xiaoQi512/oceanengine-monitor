// src/config/index.mjs - 统一配置入口（主题 F 基线）
// 配置常量、accounts.json 与 .env 均从这里加载，monitor-utils 只保留工具函数。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installConsoleInterceptor } from '../utils/logger.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(MODULE_DIR, '..', '..');
export const DATA_DIR = path.join(PROJECT_ROOT, 'monitor-data');
export const REPORT_DIR = PROJECT_ROOT;
export const ACCOUNTS_FILE = path.join(PROJECT_ROOT, 'src', 'config', 'accounts.json');

export function loadEnv() {
  const envFile = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

loadEnv();
installConsoleInterceptor();

export function loadAccounts() {
  try {
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch (e) {
    console.warn(`[config] accounts.json 读取失败: ${e.message}`);
    return [];
  }
}

export const ACCOUNTS = loadAccounts();

const DEFAULT_ACCOUNT_SOURCE = ACCOUNTS[0] || {};

export const FEISHU_CHAT_ID = process.env.LARK_MONITOR_CHAT_ID
  || DEFAULT_ACCOUNT_SOURCE.monitorChatId
  || 'oc_8deeb3061bdbd43608de252a44c97a25';
export const FEISHU_ANCHOR_CHAT_ID = process.env.LARK_REPORT_CHAT_ID
  || process.env.LARK_ANCHOR_CHAT_ID
  || DEFAULT_ACCOUNT_SOURCE.reportChatId
  || 'oc_b245ee4b255c7b25b7f8d953802c49ff';
export const BOT_APP_ID = process.env.LARK_BOT_APP_ID || 'cli_a92d0bfc68f89cb2';
export const ACCOUNT_NAME = process.env.ACCOUNT_NAME
  || DEFAULT_ACCOUNT_SOURCE.name
  || '极狐-区域福利号-直播';
export const ACCOUNT_ID = process.env.OEC_ACCOUNT_ID
  || DEFAULT_ACCOUNT_SOURCE.accountId
  || '1842681352509635';
export const VIDEO_ACCOUNT_ID = process.env.OEC_VIDEO_ACCOUNT_ID
  || DEFAULT_ACCOUNT_SOURCE.videoAccountId
  || '1852666142648332';
export const CAMPAIGN_URL = `https://ad.oceanengine.com/promotion/promote-manage/project?aadvid=${ACCOUNT_ID}`;
export const DAILY_BUDGET = Number(process.env.OEC_DAILY_BUDGET || '45000');
export const AI_DAILY_BUDGET = Number(process.env.AI_DAILY_BUDGET || '60000');
export const DAILY_START_HOUR = 7;
export const DAILY_END_HOUR = 23;

export const ACTION_QUEUE_FILE = process.env.ACTION_QUEUE_FILE || path.join(PROJECT_ROOT, 'action-queue.json');
export const ACTION_LOCK_FILE = process.env.ACTION_LOCK_FILE || path.join(PROJECT_ROOT, 'action-queue.json.lock');
export const ACTION_AUDIT_FILE = process.env.ACTION_AUDIT_FILE || path.join(DATA_DIR, 'action-audit.jsonl');
export const ACTION_PENDING_FILE = process.env.ACTION_PENDING_FILE || path.join(DATA_DIR, 'pending-actions.json');
export const HISTORY_FILE = path.join(DATA_DIR, 'suggestion-history.json');

export const SHIFT_SPREADSHEET_TOKEN = process.env.SHIFT_SPREADSHEET_TOKEN || 'GiNOslsWQhyHDPtclPscns3GnAf';
export const SHIFT_SHEET_ID = process.env.SHIFT_SHEET_ID || 'j69tpS';
export const SHIFT_BASE_DATE = new Date(2026, 5, 26);
export const SHIFT_BASE_ROW = 200;

export const AI_REGIONS = [
  { name: '东区', aadvid: '1842681994872135', reportId: '299497419' },
  { name: '西区', aadvid: '1842681830951944', reportId: '299491275' },
  { name: '中区', aadvid: '1842663909080452', reportId: '298926513' },
  { name: '南区', aadvid: '1842682454270468', reportId: '299530471' },
  { name: '北区', aadvid: '1842683071403332', reportId: '299540674' },
];

export const CDP_PORT = Number(process.env.CDP_PORT || '9222');
export const CDP_PROXY_PORT = 3456;
export const CDP_PROXY_URL = `http://localhost:${CDP_PROXY_PORT}`;
export const FEEDBACK_PORT = Number(process.env.FEEDBACK_PORT || '8899');

export const CHROME_USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR || 'D:\\ChromeCDP\\User Data';
export const CHROME_PROFILE_DIRECTORY = process.env.CHROME_PROFILE_DIRECTORY
  || DEFAULT_ACCOUNT_SOURCE.chromeProfile
  || 'Profile 4';
export const CHROME_PATHS = [
  'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  (process.env.LOCALAPPDATA || 'C:\\Users\\HTF2026\\AppData\\Local') + '\\Google\\Chrome\\Application\\chrome.exe',
];

export const DEFAULT_ACCOUNT = {
  name: ACCOUNT_NAME,
  accountId: ACCOUNT_ID,
  videoAccountId: VIDEO_ACCOUNT_ID,
  monitorChatId: FEISHU_CHAT_ID,
  reportChatId: FEISHU_ANCHOR_CHAT_ID,
  chromeProfile: CHROME_PROFILE_DIRECTORY,
};

export function validateConfig() {
  const required = [
    ['accountId', DEFAULT_ACCOUNT.accountId],
    ['videoAccountId', DEFAULT_ACCOUNT.videoAccountId],
    ['monitorChatId', DEFAULT_ACCOUNT.monitorChatId],
    ['reportChatId', DEFAULT_ACCOUNT.reportChatId],
  ];
  const missing = required
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (ACCOUNTS.length === 0) missing.push('accounts.json');
  return { ok: missing.length === 0, missing };
}

export function assertConfig() {
  const result = validateConfig();
  if (!result.ok) {
    throw new Error(`配置校验失败: ${result.missing.join(', ')}`);
  }
  return result;
}
