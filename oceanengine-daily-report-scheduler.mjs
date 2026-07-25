// ============================================================
// 巨量引擎 23:05 日报汇总调度器
// 由 Windows 任务计划程序每天 23:05 调用
// 步骤: 重新采集最新数据 → 读取全天采样 → 推送到飞书群
// ============================================================
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import {
  getLocalDate, findLarkCli, guardFeedbackServer, getTodayShiftWindow,
  atomicWriteJSON,
  DATA_DIR, FEISHU_CHAT_ID, FEEDBACK_PORT,
} from './monitor-utils.mjs';
import { pushCard } from './feishu-push-guard.mjs';
import { createLogger } from './logger.mjs';

const log = createLogger('日报').info;
const OEC_FORCE = process.env.OEC_FORCE === "1";

// ====== 去重检查：每天只允许推送一次日报 ======
const todayDateStr = getLocalDate();
const reportDoneMarker = join(DATA_DIR, `daily-report-done-${todayDateStr}.json`);
if (!OEC_FORCE && existsSync(reportDoneMarker)) {
  log("日报今日已推送过，跳过");
  process.exit(0);
}
// 立即写标记防止并发触发
try { writeFileSync(reportDoneMarker, JSON.stringify({ startedAt: new Date().toISOString() })); } catch {}

// ====== 0. 动态等待：根据当日排班下播时间，延迟到下播后 5 分钟 ======
var shiftWin = getTodayShiftWindow();
var nowDate = new Date();
var targetTime = new Date(nowDate);
targetTime.setHours(shiftWin.endHour, (shiftWin.endMinute || 0) + 5, 0, 0);
var waitMs = targetTime - nowDate;
if (waitMs > 0 && waitMs < 3600000) {
  var pad = function(n) { return String(n).padStart(2, '0'); };
  log('当日下播时间 ' + pad(shiftWin.endHour) + ':' + pad(shiftWin.endMinute || 0) + '，等待 ' + Math.round(waitMs / 1000 / 60) + ' 分钟后推送');
  await new Promise(function(resolve) { setTimeout(resolve, waitMs); });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, 'oceanengine-monitor-v3.mjs');
const NODE = process.execPath;
const LARK_CLI = findLarkCli();
const CHAT_ID = FEISHU_CHAT_ID;


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
      cwd: __dirname, encoding: 'utf8', timeout: 300000,
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
  log('❌ 当日无有效采样数据');
  process.exit(1);
}

// ====== 生成 HTML 日报 ======
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

const last = entries[entries.length - 1];
const finalSpend = last.totalSpend || 0;
const finalConversions = last.totalConversions || 0;
const finalCPA = finalConversions > 0 ? finalSpend / finalConversions : 0;
const effectiveBudget = last.accountBudget || 45000;
const budgetPct = (finalSpend / effectiveBudget * 100).toFixed(0);
const totalAlerts = entries.reduce((s, e) => s + (e.alertCount || 0), 0);
const totalLeads = last.totalLeads || 0;
const openRetainStr = last.openRetainRate ? (last.openRetainRate * 100).toFixed(1) + '%' : 'N/A';

// ====== 读取昨日/近7天对比 ======
function loadRecentLogs(days = 7) {
  const results = [];
  const base = new Date();
  for (let i = 1; i <= days; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const file = join(DATA_DIR, `daily-${dateStr}.json`);
    if (!existsSync(file)) continue;
    try {
      const log = JSON.parse(readFileSync(file, 'utf-8'));
      const entries = log.filter(e => !e.type || e.type !== 'data_gap');
      if (entries.length === 0) continue;
      const last = entries[entries.length - 1];
      results.push({ date: dateStr, finalSpend: last.totalSpend || 0, finalConversions: last.totalConversions || 0, finalCPA: (last.totalConversions || 0) > 0 ? (last.totalSpend || 0) / last.totalConversions : 0, totalLeads: last.totalLeads || 0 });
    } catch {}
  }
  return results.sort((a, b) => a.date.localeCompare(b.date));
}

const recentLogs = loadRecentLogs(7);
const yesterday = recentLogs.length > 0 ? recentLogs[recentLogs.length - 1] : null;
const avg7 = recentLogs.length > 0 ? {
  spend: recentLogs.reduce((s, r) => s + r.finalSpend, 0) / recentLogs.length,
  cpa: recentLogs.reduce((s, r) => s + r.finalCPA, 0) / recentLogs.length,
  conversions: recentLogs.reduce((s, r) => s + r.finalConversions, 0) / recentLogs.length,
} : null;

const yoySpend = yesterday && yesterday.finalSpend > 0 ? ((finalSpend - yesterday.finalSpend) / yesterday.finalSpend * 100) : null;
const yoyCPA = yesterday && yesterday.finalCPA > 0 ? ((finalCPA - yesterday.finalCPA) / yesterday.finalCPA * 100) : null;
const yoyConv = yesterday && yesterday.finalConversions > 0 ? ((finalConversions - yesterday.finalConversions) / yesterday.finalConversions * 100) : null;
const vs7Spend = avg7 && avg7.spend > 0 ? ((finalSpend - avg7.spend) / avg7.spend * 100) : null;
const vs7CPA = avg7 && avg7.cpa > 0 ? ((finalCPA - avg7.cpa) / avg7.cpa * 100) : null;
const vs7Conv = avg7 && avg7.conversions > 0 ? ((finalConversions - avg7.conversions) / avg7.conversions * 100) : null;

// 简短洞察
const insightLines = [];
if (budgetPct >= 90) insightLines.push(`⚠️ 预算接近上限（${budgetPct}%），注意余额风险`);
else if (budgetPct < 50) insightLines.push(`ℹ️ 预算消耗偏慢（${budgetPct}%），低于时间进度预期`);
if (yoySpend !== null) insightLines.push(`📊 较昨日：消耗${yoySpend >= 0 ? '+' : ''}${yoySpend.toFixed(0)}% · CPA${yoyCPA >= 0 ? '+' : ''}${yoyCPA.toFixed(0)}% · 转化${yoyConv >= 0 ? '+' : ''}${yoyConv.toFixed(0)}%`);
if (vs7Spend !== null) insightLines.push(`📈 较7日均：消耗${vs7Spend >= 0 ? '+' : ''}${vs7Spend.toFixed(0)}% · CPA${vs7CPA >= 0 ? '+' : ''}${vs7CPA.toFixed(0)}% · 转化${vs7Conv >= 0 ? '+' : ''}${vs7Conv.toFixed(0)}%`);

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
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `🔍 **今日洞察**\n${insightLines.join('\n') || '今日数据平稳，无显著风险或亮点。'}`
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
(async () => {
  if (!LARK_CLI) { log('❌ lark-cli 未找到，无法推送'); process.exit(1); }

  log('📤 推送日报卡片到飞书群...');
  const result = await pushCard(LARK_CLI, JSON.parse(cardContent), CHAT_ID, {
    timeoutMs: 20000,
    maxRetries: 1,
    circuitFailureThreshold: 2,
    circuitFailureWindow: 4,
    circuitOpenDurationMs: 60_000,
  });

  if (result.ok) {
    log(`✅ 日报已推送到飞书群 (msg: ${result.result?.data?.message_id || 'unknown'})`);
  } else {
    log(`❌ 推送失败: ${result.error || 'unknown'}`);
    if (result.fallback) {
      log(`📁 已 fallback 到本地日志: ${result.path}`);
    }
    process.exit(1);
  }

  log('🎉 23:05 日报汇总完成');
  process.exit(0);
})();
