// ============================================================
// 巨量引擎 23:05 日报汇总调度器
// 由 Windows 任务计划程序每天 23:05 调用
// 步骤: 重新采集最新数据 → 读取全天采样 → 推送到飞书群
// ============================================================
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import {
  getLocalDate, findLarkCli, guardFeedbackServer,
  atomicWriteJSON,
  DATA_DIR, FEISHU_CHAT_ID, FEEDBACK_PORT,
} from './monitor-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dirname, 'scheduler.log');
const SCRIPT = join(__dirname, 'oceanengine-monitor-v3.mjs');
const NODE = process.execPath;
const LARK_CLI = findLarkCli();
const CHAT_ID = FEISHU_CHAT_ID;

function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function log(msg) {
  const line = `[${now()}] [日报] ${msg}`;
  console.log(line);
  // 直接写文件，不经过 shell（避免注入风险）
  try { appendFileSync(LOG, line + '\n'); } catch {}
}

log('📊 启动 23:05 日报汇总流程');

// ====== 1. 守护反馈服务器 ======
const fbAlive = await guardFeedbackServer();
if (!fbAlive) log('⚠ 反馈服务器启动失败（不影响日报推送）');

// ====== 2. 尝试重新采集最新数据 (容错：Chrome可能已关闭) ======
let freshData = false;
try {
  const alive = await new Promise((resolve) => {
    const req = http.get('http://localhost:9222/json/version', { timeout: 5000 }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });

  if (alive) {
    log('🔄 Chrome 9222 仍在线，执行最终数据采集...');
    execSync(`"${NODE}" "${SCRIPT}"`, {
      cwd: __dirname, encoding: 'utf8', timeout: 180000,
      maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
    freshData = true;
    log('✅ 最终采集完成');
  } else {
    log('⚠ Chrome 9222 已离线，使用已有采样数据生成日报');
  }
} catch (e) {
  log(`⚠ 最终采集异常: ${e.message.slice(0, 100)}，使用已有数据`);
}

// ====== 3. 读取全天数据 ======
const today = getLocalDate();
const logFile = join(DATA_DIR, `daily-${today}.json`);

if (!existsSync(logFile)) {
  log('❌ 未找到当日数据文件，无法推送日报');
  process.exit(1);
}

const logData = JSON.parse(readFileSync(logFile, 'utf-8'));
const entries = logData.filter(e => !e.type || e.type !== 'data_gap');
const gaps = logData.filter(e => e.type === 'data_gap').length;

if (entries.length === 0) {
  log('❌ 当日无有效采样数据');
  process.exit(1);
}

const last = entries[entries.length - 1];
const finalSpend = last.totalSpend || 0;
const finalConversions = last.totalConversions || 0;
const finalCPA = finalConversions > 0 ? finalSpend / finalConversions : 0;
const effectiveBudget = last.accountBudget || 45000;
const budgetPct = (finalSpend / effectiveBudget * 100).toFixed(0);
const totalAlerts = entries.reduce((s, e) => s + (e.alertCount || 0), 0);
const totalLeads = last.totalLeads || 0;
const openRetainStr = last.openRetainRate ? (last.openRetainRate * 100).toFixed(1) + '%' : 'N/A';

// ====== 4. 计算分时段消耗增量 (delta) ======
// entry.time 是 UTC ISO 字符串 (e.g. "2026-06-14T15:30:00.000Z")
// new Date(iso).getHours() 自动返回本地时间（UTC+8 → 23）
function getSlotKey(entry) {
  const h = new Date(entry.time).getHours();
  if (h < 9) return '🌅 冷启动';
  if (h < 11) return '☀️ 早高峰';
  if (h < 14) return '🔥 午高峰';
  if (h < 17) return '🌤 午后';
  if (h < 20) return '🌆 晚高峰';
  return '🌙 夜收尾';
}

// 按时段分组，取每个时段的最后一个采样点（累计消耗）
const slotLastEntry = {};
entries.forEach(e => {
  const k = getSlotKey(e);
  if (!slotLastEntry[k] || new Date(slotLastEntry[k].time) < new Date(e.time)) {
    slotLastEntry[k] = e;
  }
});

// 按时段顺序计算增量
const SLOT_ORDER = ['🌅 冷启动', '☀️ 早高峰', '🔥 午高峰', '🌤 午后', '🌆 晚高峰', '🌙 夜收尾'];
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

// ====== 5. 构建飞书卡片 ======
const cardContent = JSON.stringify({
  config: { wide_screen_mode: true },
  header: {
    title: { tag: 'plain_text', content: `📊 巨量引擎 · ${today.slice(5)}投放日报` },
    template: 'indigo',
  },
  elements: [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**极狐-区域福利号-直播** | 16h直播(7-23) | ${entries.length}个采样点${gaps > 0 ? ' · ⚠断层' + gaps + '次' : ''}${freshData ? ' · ✅已终采' : ' · ⚠无终采'}`
      }
    },
    { tag: 'hr' },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `💰 **最终消耗** ¥${finalSpend.toLocaleString()} / ¥${effectiveBudget.toLocaleString()}（${budgetPct}%）\n🎯 **总转化** ${finalConversions}条 | **线索** ${totalLeads}条 | **CPA** ¥${finalCPA.toFixed(0)}\n📨 **开留率** ${openRetainStr} | 线索≈转化 ${Math.abs(totalLeads - finalConversions) <= 5 ? '✅' : 'ℹ️'}`
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
          content: `⏰ 生成时间: ${new Date().toLocaleString('zh-CN')} · 监控 Bot 自动生成`
        }
      ]
    },
  ],
});

// ====== 6. 推送到飞书 ======
try {
  if (!LARK_CLI) { log('❌ lark-cli 未找到，无法推送'); process.exit(1); }

  const tmpFile = join(__dirname, '.temp_daily_card.json');
  writeFileSync(tmpFile, cardContent);

  log('📤 推送日报卡片到飞书群...');
  const pushOutput = execSync(
    `"${LARK_CLI}" im +messages-send --as bot --msg-type interactive --chat-id ${CHAT_ID} --content @"${tmpFile}"`,
    { cwd: __dirname, encoding: 'utf8', timeout: 15000 }
  );

  let result;
  try { result = JSON.parse(pushOutput); } catch { result = { ok: false, error: 'JSON解析失败' }; }
  if (result.ok) {
    log(`✅ 日报已推送到飞书群 (msg: ${result.data?.message_id || 'unknown'})`);
  } else {
    log(`❌ 推送失败: ${JSON.stringify(result.error || result)}`);
  }
} catch (e) {
  log(`❌ 飞书推送失败: ${(e.stderr || e.message || '').toString().slice(0, 200)}`);
  process.exit(1);
}

log('🎉 23:05 日报汇总完成');
process.exit(0);
