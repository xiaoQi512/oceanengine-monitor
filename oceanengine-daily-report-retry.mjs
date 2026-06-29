// ============================================================
// 巨量引擎 日报补推脚本
// 用法: node oceanengine-daily-report-retry.mjs [YYYY-MM-DD]
// 不指定日期则使用昨天
// ============================================================
import { readFileSync, existsSync, appendFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { execSync, spawnSync } from 'child_process';

import {
  getLocalDate, findLarkCli, guardFeedbackServer,
  atomicWriteJSON,
  DATA_DIR, FEISHU_CHAT_ID, FEEDBACK_PORT,
} from './monitor-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dirname, 'scheduler.log');
const NODE = process.execPath;
const LARK_CLI = findLarkCli();
const CHAT_ID = FEISHU_CHAT_ID;

function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function log(msg) {
  const line = `[${now()}] [日报补推] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG, line + '\n'); } catch {}
}

// 日期：命令行参数或昨天
const targetDate = process.argv[2] || (() => {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
})();

log(`📊 开始补推日报，目标日期: ${targetDate}`);

if (!LARK_CLI) { log('❌ lark-cli 未找到'); process.exit(1); }

// 守护反馈服务器
const fbAlive = await guardFeedbackServer();
if (!fbAlive) log('⚠ 反馈服务器启动失败（不影响推送）');

// 读取数据文件
const logFile = join(DATA_DIR, `daily-${targetDate}.json`);
if (!existsSync(logFile)) {
  log(`❌ 未找到数据文件: ${logFile}`);
  process.exit(1);
}

let logData;
try {
  logData = JSON.parse(readFileSync(logFile, 'utf-8'));
} catch (e) {
  log(`❌ 日志解析失败: ${e.message.slice(0, 100)}`);
  process.exit(1);
}

const entries = logData.filter(e => !e.type || e.type !== 'data_gap');
const gaps = logData.filter(e => e.type === 'data_gap').length;

if (entries.length === 0) {
  log(`❌ ${targetDate} 无有效采样数据（共 ${logData.length} 条，全部为 data_gap）`);
  process.exit(1);
}

log(`✅ 有效采样 ${entries.length} 条，断层 ${gaps} 次`);

// 生成 HTML 日报（补推时同步刷新）
try {
  const reportScript = join(__dirname, 'oceanengine-daily-report.mjs');
  execSync(`"${NODE}" "${reportScript}"`, {
    cwd: __dirname, encoding: 'utf8', timeout: 120000,
    maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  log('✅ HTML 日报已生成');
} catch (e) {
  log(`⚠ HTML 日报生成异常: ${e.message.slice(0, 100)}`);
}

// 统计数据
const last = entries[entries.length - 1];
const finalSpend = last.totalSpend || 0;
const finalConversions = last.totalConversions || 0;
const finalCPA = finalConversions > 0 ? finalSpend / finalConversions : 0;
const effectiveBudget = last.accountBudget || 45000;
const budgetPct = (finalSpend / effectiveBudget * 100).toFixed(0);
const totalAlerts = entries.reduce((s, e) => s + (e.alertCount || 0), 0);
const totalLeads = last.totalLeads || 0;
const openRetainStr = last.openRetainRate ? (last.openRetainRate * 100).toFixed(1) + '%' : 'N/A';

// 分时段
function getSlotKey(entry) {
  const h = new Date(entry.time).getHours();
  if (h < 9) return '🌅 冷启动';
  if (h < 11) return '☀️ 早高峰';
  if (h < 14) return '🔥 午高峰';
  if (h < 17) return '🌤️ 午后';
  if (h < 20) return '🌆 晚高峰';
  return '🌙 夜收尾';
}

const slotLastEntry = {};
entries.forEach(e => {
  const k = getSlotKey(e);
  if (!slotLastEntry[k] || new Date(slotLastEntry[k].time) < new Date(e.time)) {
    slotLastEntry[k] = e;
  }
});

const SLOT_ORDER = ['🌅 冷启动', '☀️ 早高峰', '🔥 午高峰', '🌤️ 午后', '🌆 晚高峰', '🌙 夜收尾'];
let prevSlotSpend = 0;
const slotLines = [];
for (const slot of SLOT_ORDER) {
  const entry = slotLastEntry[slot];
  if (!entry) continue;
  const slotSpend = (entry.totalSpend || 0) - prevSlotSpend;
  prevSlotSpend = entry.totalSpend || 0;
  const slotPct = finalSpend > 0 ? (slotSpend / finalSpend * 100) : 0;
  slotLines.push(`${slot} → ¥${slotSpend.toLocaleString()}（${slotPct.toFixed(0)}%）`);
}

// 构建飞书卡片
const cardContent = JSON.stringify({
  config: { wide_screen_mode: true },
  header: {
    title: { tag: 'plain_text', content: `📊 巨量引擎 · ${targetDate.slice(5)}投放日报（补推）` },
    template: 'indigo',
  },
  elements: [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**极狐-区域福利号-直播** | 16h直播(7-23) | ${entries.length}个采样点${gaps > 0 ? ' · ⚠断层' + gaps + '次' : ''}`
      }
    },
    { tag: 'hr' },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `💰 **最终消耗** ¥${finalSpend.toLocaleString()} / ¥${effectiveBudget.toLocaleString()}（${budgetPct}%）\n🎯 **总转化** ${finalConversions}条 | **线索** ${totalLeads}条 | **CPA** ¥${finalCPA.toFixed(0)}\n📬 **开留率** ${openRetainStr} | 线索≈转化 ${Math.abs(totalLeads - finalConversions) <= 5 ? '✅' : 'ℹ️'}`
      }
    },
    { tag: 'hr' },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `⏰ **分时段消耗增量**\n${slotLines.join('\n')}`
      }
    },
    { tag: 'hr' },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `🔔 **今日告警** ${totalAlerts}次 | ⚠数据断层 ${gaps}次`
      }
    },
    { tag: 'hr' },
    {
      tag: 'note',
      elements: [
        {
          tag: 'plain_text',
          content: `⏰ 生成时间: ${new Date().toLocaleString('zh-CN')} · 监控 Bot 自动生成（补推）`
        }
      ]
    },
  ],
});

const tmpFile = join(__dirname, '.temp_daily_card.json');
writeFileSync(tmpFile, cardContent);

// 推送
try {
  const cardJSON = readFileSync(tmpFile, 'utf8');
  log('📤 推送日报卡片到飞书群...');

  const result = spawnSync(
    LARK_CLI,
    [
      'im', '+messages-send',
      '--as', 'bot',
      '--msg-type', 'interactive',
      '--chat-id', CHAT_ID,
      '--content', cardJSON
    ],
    { cwd: __dirname, encoding: 'utf8', timeout: 20000 }
  );

  const pushOutput = (result.stdout || '') + (result.stderr || '');
  let parseResult;
  try { parseResult = JSON.parse(pushOutput); } catch { parseResult = { ok: false, error: pushOutput.slice(0, 200) }; }
  if (parseResult.ok) {
    log(`✅ 日报已推送到飞书群 (msg: ${parseResult.data?.message_id || 'unknown'})`);
  } else {
    log(`❌ 推送失败: ${JSON.stringify(parseResult.error || parseResult)}`);
    process.exit(1);
  }
} catch (e) {
  log(`❌ 飞书推送异常: ${(e.stderr || e.message || '').toString().slice(0, 200)}`);
  process.exit(1);
}

log(`🎉 ${targetDate} 日报补推完成`);
process.exit(0);
