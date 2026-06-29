// monitor-utils.mjs — 共享工具模块
// 供 monitor-v3 / daily-report-scheduler / feedback-server / daily-report 共用
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ====== 共享路径常量 ======
export const DATA_DIR = path.join(__dirname, 'monitor-data');
export const REPORT_DIR = __dirname;
export const HISTORY_FILE = path.join(DATA_DIR, 'suggestion-history.json');
export const FEEDBACK_PORT = 8899;
export const FEISHU_CHAT_ID = 'oc_8deeb3061bdbd43608de252a44c97a25';
export const ACCOUNT_NAME = '极狐-区域福利号-直播';
export const ACCOUNT_ID = '1842681352509635';
export const CAMPAIGN_URL = `https://ad.oceanengine.com/promotion/promote-manage/project?aadvid=${ACCOUNT_ID}`;
export const DAILY_BUDGET = 45000;
export const DAILY_START_HOUR = 7;
export const DAILY_END_HOUR = 23;

// ====== getLocalDate — 中国本地日期 YYYY-MM-DD ======
export function getLocalDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  for (const c of candidates) {
    try {
      if (c.endsWith('.exe')) {
        const r = spawnSync(c, ['--version'], { timeout: 3000, encoding: 'utf-8', windowsHide: true });
        if (r.status === 0) return c;
      } else {
        execSync(`"${c}" --version`, { stdio: 'pipe', timeout: 3000 });
        return c;
      }
    } catch {}
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
