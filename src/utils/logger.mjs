// logger.mjs - 统一日志聚合模块
// 结构化 JSON 行 (ndjson) + 人类可读纯文本 (monitor.log)，按日轮转，保留 N 天
// installConsoleInterceptor() 劫持 console.* 让现有脚本零改动聚合
// 零依赖（不 import monitor-utils，避免循环依赖）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'monitor-data');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const PLAIN_LOG = path.join(DATA_DIR, 'monitor.log');

let _interceptorInstalled = false;
let _currentLogDate = '';
let _lastRotateCheck = 0;

function isSilent() { return process.env.OEC_SILENT === '1'; }
function retentionDays() { return parseInt(process.env.LOG_RETENTION_DAYS || '14', 10); }

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function ensureDirs() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// 按日轮转：把非当天的 monitor.log 归档到 logs/monitor-YYYY-MM-DD.log
function maybeRotate() {
  const now = Date.now();
  if (now - _lastRotateCheck < 3600000) return; // 每小时最多检查一次
  _lastRotateCheck = now;
  const today = todayStr();
  if (_currentLogDate === today) return;
  _currentLogDate = today;
  try {
    if (fs.existsSync(PLAIN_LOG)) {
      const mtime = fs.statSync(PLAIN_LOG).mtime;
      const mdate = mtime.getFullYear() + '-' + String(mtime.getMonth() + 1).padStart(2, '0') + '-' + String(mtime.getDate()).padStart(2, '0');
      if (mdate !== today) {
        const archived = path.join(LOGS_DIR, 'monitor-' + mdate + '.log');
        if (!fs.existsSync(archived)) {
          fs.renameSync(PLAIN_LOG, archived);
        } else {
          fs.appendFileSync(archived, fs.readFileSync(PLAIN_LOG, 'utf-8'));
          fs.writeFileSync(PLAIN_LOG, '');
        }
        cleanupOldLogs();
      }
    }
  } catch {}
}

function cleanupOldLogs() {
  try {
    const cutoff = Date.now() - retentionDays() * 86400000;
    for (const f of fs.readdirSync(LOGS_DIR)) {
      const fp = path.join(LOGS_DIR, f);
      try { if (fs.statSync(fp).mtime.getTime() < cutoff) fs.unlinkSync(fp); } catch {}
    }
  } catch {}
}

function fmtPlain(level, module, msg) {
  const ts = new Date().toLocaleString('zh-CN', { hour12: false });
  const mod = module ? '[' + module + '] ' : '';
  return '[' + ts + '] [' + level.toUpperCase() + '] ' + mod + msg + '\n';
}

function writeLog(level, module, args) {
  const msg = args.map(a => (a && typeof a === 'object') ? JSON.stringify(a) : String(a)).join(' ');
  ensureDirs();
  maybeRotate();
  // 纯文本（monitor-daemon 正则扫描兼容）
  try { fs.appendFileSync(PLAIN_LOG, fmtPlain(level, module, msg)); } catch {}
  // 结构化 JSON 行
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, module: module || 'app', msg }) + '\n';
  try { fs.appendFileSync(path.join(LOGS_DIR, 'monitor-' + todayStr() + '.ndjson'), entry); } catch {}
}

export function createLogger(module) {
  return {
    debug: (...a) => writeLog('debug', module, a),
    info: (...a) => writeLog('info', module, a),
    warn: (...a) => writeLog('warn', module, a),
    error: (...a) => writeLog('error', module, a),
  };
}

// ====== 变更日志（统一聚合：运行日志 + agent 修改日志） ======
// 任何 agent/工具对项目内容（代码/文档/配置/数据库）的更改，统一在此记录：
//   reason  = 调试原因（为什么改）
//   method  = 执行方法（怎么改的）
//   result  = done / partial / failed（是否执行完成）
// 写入位置与运行日志同一文件：monitor-data/logs/monitor-YYYY-MM-DD.ndjson + monitor.log
const CHANGE_RESULTS = ['done', 'partial', 'failed'];
export function writeChange({ agent = 'unknown', reason = '', method = '', files = '', result = 'done', tag = '', module = 'change' } = {}) {
  if (!CHANGE_RESULTS.includes(result)) result = 'done';
  const fileStr = Array.isArray(files) ? files.join(', ') : String(files || '');
  const level = result === 'failed' ? 'error' : (result === 'partial' ? 'warn' : 'info');
  const msg = '[CHANGE] agent=' + agent
    + (tag ? ' tag=' + tag : '')
    + ' 原因:' + reason
    + ' 方法:' + method
    + (fileStr ? ' 文件:' + fileStr : '')
    + ' 结果:' + result;
  writeLog(level, module, [msg]);
  return { ts: new Date().toISOString(), agent, reason, method, files: fileStr, result, tag };
}

// 劫持 console.* 让现有脚本零改动聚合；OEC_SILENT=1 时抑制 stdout
export function installConsoleInterceptor() {
  if (_interceptorInstalled) return;
  _interceptorInstalled = true;
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  const origInfo = console.info.bind(console);
  const silent = isSilent();
  console.log = (...a) => { if (!silent) origLog(...a); writeLog('info', '', a); };
  console.warn = (...a) => { if (!silent) origWarn(...a); writeLog('warn', '', a); };
  console.error = (...a) => { if (!silent) origError(...a); writeLog('error', '', a); };
  console.info = (...a) => { if (!silent) origInfo(...a); writeLog('info', '', a); };
  if (silent) {
    // 抑制子进程 stdout/stderr 污染 PM2 日志（保持原有行为）
    const noop = () => {};
    process.stdout.write = noop;
    process.stderr.write = noop;
  }
}
