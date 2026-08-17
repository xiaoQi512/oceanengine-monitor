// scripts/watchdog.mjs - 监控系统自身健康检查
// 每 5 分钟由 PM2 cron 调用：
//   1. 检查最新 15min 快照是否新鲜（默认 35 分钟内）
//   2. 检查最新 5m 快照是否新鲜（默认 10 分钟内）
//   3. 检查 feedback-server /health 是否正常
// 连续 2 次异常或单次严重异常时推送飞书告警，避免监控系统本身停机无感知。
// 环境变量:
//   WATCHDOG_STATE_FILE      状态文件路径
//   WATCHDOG_15MIN_MAX_AGE_MS 15min 快照最大允许年龄，默认 35*60*1000
//   WATCHDOG_5MIN_MAX_AGE_MS  5min 快照最大允许年龄，默认 10*60*1000
//   WATCHDOG_ALERT_COOLDOWN_MS 两次告警最小间隔，默认 15*60*1000
//   WATCHDOG_FAIL_THRESHOLD   连续失败多少次触发告警，默认 2
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLarkCli, FEISHU_CHAT_ID, DATA_DIR, FEEDBACK_PORT } from '../src/utils/monitor-utils.mjs';
import { pushText } from '../src/feishu/guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const STATE_FILE = process.env.WATCHDOG_STATE_FILE || path.join(DATA_DIR, 'watchdog-state.json');
const FIFTEEN_MAX_AGE = Number(process.env.WATCHDOG_15MIN_MAX_AGE_MS || '2100000'); // 35min
const FIVE_MAX_AGE = Number(process.env.WATCHDOG_5MIN_MAX_AGE_MS || '600000'); // 10min
const ALERT_COOLDOWN = Number(process.env.WATCHDOG_ALERT_COOLDOWN_MS || '900000'); // 15min
const FAIL_THRESHOLD = Number(process.env.WATCHDOG_FAIL_THRESHOLD || '2');

function log(...args) {
  console.log(`[watchdog] ${new Date().toLocaleString('zh-CN', { hour12: false })} |`, ...args);
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
  catch { return { consecutiveFailures: 0, lastAlertAt: 0 }; }
}

function saveState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8'); } catch {}
}

function latestFile(matchPrefix, matchSuffix) {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => f.startsWith(matchPrefix) && f.endsWith(matchSuffix))
      .sort();
    return files.length ? files[files.length - 1] : null;
  } catch { return null; }
}

function fileAgeMs(fileName) {
  try {
    const stat = fs.statSync(path.join(DATA_DIR, fileName));
    return Date.now() - stat.mtimeMs;
  } catch { return Infinity; }
}

function checkHealth() {
  return new Promise((resolve) => {
    const url = `http://127.0.0.1:${FEEDBACK_PORT}/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then(r => {
        clearTimeout(timer);
        resolve(r.ok);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(false);
      });
  });
}

function buildAlertMessage(failures) {
  const lines = [
    '⚠️ 监控系统健康检查异常',
    '',
    ...failures.map(f => `- ${f}`),
    '',
    `连续失败次数: ${Math.max(1, failures.length)}`,
    `时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
  ];
  return lines.join('\n');
}

async function main() {
  const failures = [];
  const state = loadState();

  // 1. 15min 快照新鲜度（最新快照 JSON 文件）
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    const newest = files[files.length - 1];
    if (!newest) {
      failures.push('未找到任何 15min 快照文件');
    } else {
      const age = Date.now() - fs.statSync(path.join(DATA_DIR, newest)).mtimeMs;
      if (age > FIFTEEN_MAX_AGE) {
        failures.push(`15min 快照过期: ${newest} (${Math.round(age / 60000)} 分钟前)`);
      }
    }
  } catch (e) {
    failures.push(`15min 快照检查异常: ${e.message}`);
  }

  // 2. 5m 快照新鲜度（5m-*.json 文件）
  const latest5 = latestFile('5m-', '.json');
  if (!latest5) {
    failures.push('未找到任何 5m 快照文件');
  } else {
    const age = fileAgeMs(latest5);
    if (age > FIVE_MAX_AGE) {
      failures.push(`5m 快照过期: ${latest5} (${Math.round(age / 60000)} 分钟前)`);
    }
  }

  // 3. feedback-server 健康检查
  const healthOk = await checkHealth();
  if (!healthOk) {
    failures.push('feedback-server /health 不可达');
  }

  if (failures.length === 0) {
    state.consecutiveFailures = 0;
    saveState(state);
    log('✅ 全部健康检查通过');
    process.exit(0);
  }

  // 异常处理
  state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
  const now = Date.now();
  const shouldAlert = state.consecutiveFailures >= FAIL_THRESHOLD
    && (now - (state.lastAlertAt || 0)) >= ALERT_COOLDOWN;

  log(`⚠️ 发现 ${failures.length} 项异常，连续失败 ${state.consecutiveFailures} 次`);
  failures.forEach(f => log(`  - ${f}`));

  if (shouldAlert) {
    const larkCmd = findLarkCli();
    if (larkCmd) {
      const text = buildAlertMessage(failures);
      const result = await pushText(larkCmd, text, FEISHU_CHAT_ID);
      if (result.ok) {
        log('✅ 飞书告警已发送');
        state.lastAlertAt = now;
      } else {
        log(`❌ 飞书告警发送失败: ${result.error || 'unknown'}`);
      }
    } else {
      log('⚠️ lark-cli 未找到，跳过飞书告警');
    }
    state.lastAlertAt = now;
  }

  saveState(state);
  process.exit(failures.length ? 1 : 0);
}

main().catch(e => {
  console.error('[watchdog] fatal:', e.message);
  process.exit(1);
});
