// oceanengine-5min-check.mjs — 5分钟轻量消耗汇报 (v4)
// 在15分钟完整汇报之间(每5分钟)推送简洁消耗卡片到飞书群
// v4: HTTP API 优先，CDP 降级，feishu-push-guard 熔断守卫
// 测试模式: OEC_FORCE=1 绕整点跳过; OEC_DRY_RUN=1 不发送实际推送
// 用法: node oceanengine-5min-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR, FEISHU_CHAT_ID,
  findLarkCli, getLocalDate, minutesBetween, getTodayShiftWindow, getLiveWindowLabel,
} from './monitor-utils.mjs';
import { createClient as createApiClient, getDashboardStats, getProjects, collectAllData, getHourlyStats } from './oceanengine-api-client.mjs';
import { pushCard } from './feishu-push-guard.mjs';
import { insertSnapshot } from './db/writer.mjs';

const OEC_FORCE = process.env.OEC_FORCE === '1';
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === '1';
const PM2_PREFIX = process.env.OEC_PM2_TEST === '1' ? '🧪 [PM2测试] ' : '';

// ====== 工具函数 ======
function atomicWriteAtomic(filePath, content) {
  try { fs.writeFileSync(filePath, content, 'utf-8'); } catch {}
}

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function nowISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function timeStr() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


// ====== 加载近5次5分钟快照（用于环比） ======
function loadRecent5minSnapshots(limit = 3) {
  const today = getLocalDate();
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => f.startsWith('5m-') && f.includes(today))
      .sort()
      .reverse(); // 最新在前
    return files.slice(0, limit).map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8')); }
      catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

// ====== 获取有效消耗（优先账户工具栏数据，汇总行不可靠） ======
function getSpend(data) { return data.accountSpend || data.summarySpend || 0; }
function getConv(data) { return data.totalConv || data.summaryConv || 0; }

// ====== 计算环比（相邻快照真实分钟差 + 每分钟速率 + 15分钟备份环比） ======
function calcRolling(data, prevSnapshots) {
  // 需要至少4个快照(含当前)来构建3个连续窗口
  const all = [data, ...prevSnapshots].slice(0, 4);
  const windows = [];
  const now = new Date().toISOString();

  for (let i = 0; i < Math.min(all.length - 1, 3); i++) {
    const newer = getSpend(all[i]);       // 较新快照
    const older = getSpend(all[i + 1]);   // 较旧快照
    const delta = newer - older;
    const pct = older > 0 ? ((delta / older) * 100).toFixed(1) : (delta > 0 ? '+' : '0');
    const windowMinutes = minutesBetween(all[i + 1].time, all[i].time);
    const rpm = delta / windowMinutes;  // 每分钟平均速率（真实经过分钟）
    const newerAge = minutesBetween(all[i].time, now);
    const olderAge = minutesBetween(all[i + 1].time, now);
    const label = i === 0
      ? `近${Math.round(windowMinutes)}分钟`
      : `前${Math.round(newerAge)}-${Math.round(olderAge)}分钟`;
    windows.push({ label, delta, pct, rpm, windowMinutes, olderSpend: older, newerSpend: newer });
  }

  // 找出涨跌幅度最大的窗口
  let maxDelta = 0, maxIdx = 0;
  windows.forEach((w, i) => { if (Math.abs(w.delta) > Math.abs(maxDelta)) { maxDelta = w.delta; maxIdx = i; } });
  if (windows[maxIdx]) windows[maxIdx].hot = true;

  // 最新窗口增量（与最近一次快照的真实差值）
  const last5min = prevSnapshots.length > 0 ? getSpend(data) - getSpend(prevSnapshots[0]) : 0;
  const last5minMinutes = prevSnapshots.length > 0 ? minutesBetween(prevSnapshots[0].time, data.time) : 0;
  // 近5分钟转化增量
  const convLast5min = prevSnapshots.length > 0 ? getConv(data) - getConv(prevSnapshots[0]) : 0;

  return { last5min, last5minMinutes, windows, convLast5min };
}

// ====== 推送到飞书 (使用熔断守卫) ======
async function pushToLark(data, rolling) {
  const larkCli = findLarkCli();
  if (!larkCli) { console.log('  ⚠ lark-cli 不可用'); return false; }

  if (OEC_DRY_RUN) {
    console.log('  🧪 OEC_DRY_RUN=1，跳过飞书推送');
    console.log(`  📋 将推送: 近${Math.round(rolling.last5minMinutes || 5)}分钟消耗 ¥${rolling.last5min.toFixed(0)}`);
    return false;
  }

  const now = timeStr();
  const trendLines = rolling.windows.map(w => {
    const dir = parseFloat(w.pct) > 0 ? '↑' : parseFloat(w.pct) < 0 ? '↓' : '→';
    const hot = w.hot ? ' 🔥' : '';
    const sign = w.delta >= 0 ? '+' : '';
    return `${w.label}: ${dir}${Math.abs(parseFloat(w.pct)).toFixed(0)}% (${sign}¥${w.delta.toFixed(0)}) · ¥${w.rpm.toFixed(0)}/min${hot}`;
  }).join('\n');

  const card = {
    config: { wide_screen_mode: false },
    header: {
      title: { tag: 'plain_text', content: `${PM2_PREFIX}⏱ 5分钟速报 · ${now}` },
      template: 'wathet',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            `💰 **近${Math.round(rolling.last5minMinutes || 5)}分钟消耗**: ¥${rolling.last5min.toFixed(0)} | **今日累计**: ¥${getSpend(data).toFixed(0)}`,
            `📊 **预算**: ¥${data.accountBudget > 0 ? data.accountBudget.toFixed(0) : '--'} | **投放中**: ${data.activeCount}条`,
            `🎯 **近${Math.round(rolling.last5minMinutes || 5)}分钟转化**: +${rolling.convLast5min}条 | **今日累计**: ${getConv(data)}条`,
            `📡 **近${Math.round(rolling.last5minMinutes || 5)}m CPL**: ¥${rolling.last5min > 0 && rolling.convLast5min > 0 ? (rolling.last5min / rolling.convLast5min).toFixed(0) : '--'} | **CPM**: ¥${data._recentCPM > 0 ? data._recentCPM.toFixed(1) : '--'}`,
            ``,
            `📈 **消耗环比**:`,
            `${trendLines}`,
          ].join('\n')
        }
      }
    ]
  };

  const result = await pushCard(larkCli, card, FEISHU_CHAT_ID, {
    timeoutMs: 15000,
    maxRetries: 1,
    circuitFailureThreshold: 2,
    circuitFailureWindow: 4,
    circuitOpenDurationMs: 60_000,
  });

  if (result.ok) {
    console.log('  📨 5分钟速报已推送');
    return true;
  }
  console.log('  ❌ 推送异常:', result.error || 'unknown');
  if (result.fallback) console.log('  📁 已 fallback 到本地日志:', result.path);
  return false;
}

// ====== 推送15分钟详细卡片（整刻钟用，参照 monitor-v3 模板） ======
async function pushDetailedCard() {
  const larkCli = findLarkCli();
  if (!larkCli) { console.log('  ⚠ lark-cli 不可用，跳过详细卡片'); return false; }
  if (OEC_DRY_RUN) { console.log('  🧪 OEC_DRY_RUN=1，跳过详细卡片推送'); return false; }

  console.log('  📡 拉取完整数据...');
  const apiClient = await createApiClient({ useCache: true });
  const allData = await collectAllData(apiClient);
  if (!allData || !allData.campaigns) { console.log('  ❌ 数据采集失败'); return false; }

  const campaigns = allData.campaigns;
  const pageSummary = allData.pageSummary || {};
  const spend = allData.accountSpend || 0;
  const budget = allData.accountBudget || 60000;
  const balance = allData.accountBalance || 0;

  // ---- 汇总指标 ----
  const totalConversions = pageSummary.conversions || 0;
  const totalFormSubmit = pageSummary.formSubmit || 0;
  const totalPrivateMsgOpen = pageSummary.privateMsgOpen || 0;
  const totalPrivateMsgRetain = pageSummary.privateMsgRetain || 0;
  const totalLeads = pageSummary.leads || pageSummary.attributionClue || 0;
  const totalLiveViews = pageSummary.liveViews || pageSummary.liveEnter || 0;
  const totalLiveOver1Min = pageSummary.liveOneMin || pageSummary.liveOver1Min || 0;
  const avgCPM = pageSummary.cpm || campaigns.reduce(function(s, c) { return s + (c.cpm || 0); }, 0) / Math.max(campaigns.length, 1) || 0;
  const avgCPA = totalConversions > 0 ? spend / totalConversions : 0;
  const totalImpressions = pageSummary.impressions || 0;

  // 投放中/有消耗/起量/掉量
  const activeCampaigns = campaigns.filter(function(c) { return c.status === '投放中' || c.rawStatus === '启用' || c.rawStatus === '投放中'; });
  const spendingCampaigns = campaigns.filter(function(c) { return c.spend > 0; });
  const recentSnaps = loadRecent5minSnapshots(6);

  // 近5分钟展示数差值（CPM = 消耗差值 ÷ 展示差值 × 1000）
  const lastImpSnap = recentSnaps.find(s => s.impressions > 0);
  const near5mImpressions = lastImpSnap && totalImpressions > lastImpSnap.impressions ? totalImpressions - lastImpSnap.impressions : 0;
  let rampingCount = 0, droppingCount = 0;
  if (recentSnaps.length >= 2) {
    const prevSpending = recentSnaps[recentSnaps.length - 1].spendingCount || 0;
    const currSpending = spendingCampaigns.length;
    if (currSpending > prevSpending) rampingCount = currSpending - prevSpending;
    if (currSpending < prevSpending) droppingCount = prevSpending - currSpending;
  }

  const openRetainRate = totalPrivateMsgOpen > 0 ? ((totalPrivateMsgRetain / totalPrivateMsgOpen) * 100) : 0;
  const viewRetention = totalLiveViews > 0 ? ((totalLiveOver1Min / totalLiveViews) * 100) : 0;

  // ---- 时间/预算进度 ----
  const liveWin = getLiveWindowLabel();
  const shift = getTodayShiftWindow();
  const now = new Date();
  let timeElapsedH = 0, timeTotalH = 17, timePct = 0;
  if (shift && shift.startHour != null) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), shift.startHour, shift.startMinute || 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), shift.endHour, shift.endMinute || 0, 0);
    timeTotalH = (end - start) / 3600000;
    timeElapsedH = Math.max(0, (now - start) / 3600000);
    timePct = timeTotalH > 0 ? (timeElapsedH / timeTotalH) * 100 : 0;
  }
  const budgetPct = budget > 0 ? (spend / budget) * 100 : 0;
  const projectedDaily = timePct > 0.5 ? spend / (timePct / 100) : spend / 0.01;
  const remainingH = timeTotalH - timeElapsedH;
  const daysRemaining = projectedDaily > 0 && balance > 0 ? balance / projectedDaily : 0;
  const speedVal = timeElapsedH > 0 ? spend / Math.max(timeElapsedH, 0.01) / 60 : 0;

  const pacingHealth = budgetPct > timePct * 1.3 ? '🔴 消耗超速'
    : budgetPct > timePct * 1.1 ? '🟡 消耗偏快'
    : budgetPct < timePct * 0.7 ? '🔵 消耗偏慢' : '✅ 节奏正常';
  const headerColor = budgetPct > timePct * 1.3 ? 'red' : budgetPct > timePct * 1.1 ? 'orange' : 'green';

  const makeBar = function(pct) {
    var barLen = 10, filled = Math.min(Math.round(pct / 10), barLen);
    return '█'.repeat(filled) + '░'.repeat(barLen - filled);
  };

  // ---- 消耗环比（calcRolling） ----
  const fakeData = { accountSpend: spend, summarySpend: spend, totalConv: totalConversions, summaryConv: totalConversions, activeCount: activeCampaigns.length, accountBudget: budget, accountBalance: balance, time: new Date().toISOString() };
  const rolling = calcRolling(fakeData, recentSnaps);

  // 近15分钟CPM (查找~15分钟前的快照，消耗差值 ÷ 展示差值 × 1000)
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  let snapshot15m = null;
  for (let i = recentSnaps.length - 1; i >= 0; i--) {
    if (recentSnaps[i].impressions > 0 && recentSnaps[i].time < fifteenMinAgo) {
      snapshot15m = recentSnaps[i];
      break;
    }
  }
  const spend15m = snapshot15m ? spend - (snapshot15m.accountSpend || snapshot15m.summarySpend || 0) : rolling.last5min;
  const imp15m = snapshot15m ? totalImpressions - snapshot15m.impressions : near5mImpressions;

  // 近15分钟停留率 (>1min观看差值 ÷ 观看数差值)，回退到累计值
  let deltaRetention = viewRetention;
  if (snapshot15m && snapshot15m.liveViews > 0 && snapshot15m.liveOver1Min > 0) {
    const dViews = totalLiveViews - snapshot15m.liveViews;
    const dOver1Min = totalLiveOver1Min - snapshot15m.liveOver1Min;
    if (dViews > 0) deltaRetention = (dOver1Min / dViews) * 100;
  }
  const snapMinutes = snapshot15m ? Math.round(minutesBetween(snapshot15m.time, new Date().toISOString())) : 15;
  const snapConv = snapshot15m ? totalConversions - (snapshot15m.totalConv || 0) : rolling.convLast5min;
  const snapSpeed = snapMinutes > 0 ? spend15m / snapMinutes : 0;
  const trendLines = rolling.windows.map(function(w) {
    var dir = parseFloat(w.pct) > 0 ? '↑' : parseFloat(w.pct) < 0 ? '↓' : '→';
    var hot = w.hot ? ' 🔥' : '';
    var sign = w.delta >= 0 ? '+' : '';
    return '  ' + w.label + ': ' + dir + Math.abs(parseFloat(w.pct)).toFixed(0) + '% (' + sign + '¥' + w.delta.toFixed(0) + ') · ¥' + w.rpm.toFixed(0) + '/min' + hot;
  }).join('\n');
  const lastNMin = Math.round(rolling.last5minMinutes || 5);

  // ---- 昨日同时段对比 ----
  let yesterdayLines = [];
  try {
    const hourStats = await getHourlyStats(apiClient, { startHour: shift ? shift.startHour : 6, endHour: now.getHours() });
    if (hourStats && hourStats.yesterday) {
      const ySpend = hourStats.yesterday.spend || 0;
      const yConv = hourStats.yesterday.conversions || 0;
      const yCPA = yConv > 0 ? ySpend / yConv : 0;
      const spendVs = ySpend > 0 ? ((spend / ySpend - 1) * 100) : 0;
      const cpaVs = yCPA > 0 ? ((avgCPA / yCPA - 1) * 100) : 0;
      yesterdayLines.push('📅 **昨日同时段**: 消耗 ¥' + ySpend.toFixed(0) + ' (' + (spendVs >= 0 ? '+' : '') + spendVs.toFixed(0) + '%) · CPL ¥' + yCPA.toFixed(0) + ' (' + (cpaVs >= 0 ? '+' : '') + cpaVs.toFixed(0) + '%) · ' + yConv + '条转化');
    }
  } catch(e) {}

  // ---- TOP5 有消耗计划 ----
  const topSpenders = campaigns.filter(function(c) { return c.spend > 0; }).sort(function(a, b) { return b.spend - a.spend; }).slice(0, 5);
  const topLines = topSpenders.length > 0 ? ['📊 **有消耗计划 TOP5**'] : [];
  topSpenders.forEach(function(c, i) { topLines.push((i + 1) + '. ' + c.name.slice(0, 18) + ' — ¥' + c.spend.toFixed(0) + ' · ' + c.conversions + '转化 · ' + (c.cpm > 0 ? 'CPM ¥' + c.cpm.toFixed(1) : '')); });

  // ---- 构建卡片 ----
  const nowLocale = new Date().toLocaleString('zh-CN');
  const timeSlot = shift ? liveWin.labelCompact : '';
  const elements = [];

  elements.push({ tag: 'div', text: { tag: 'lark_md', content: [
    makeBar(timePct) + ' ' + timePct.toFixed(0) + '%  (已过' + timeElapsedH.toFixed(1) + 'h/' + timeTotalH.toFixed(0) + 'h)',
    makeBar(Math.min(budgetPct, 100)) + ' ' + budgetPct.toFixed(0) + '%  (¥' + spend.toFixed(0) + ' / ¥' + budget.toFixed(0) + ')',
    '📊 ' + pacingHealth + ' | ' + timeSlot,
    projectedDaily > 0 ? '🎯 预估今日 ¥' + projectedDaily.toFixed(0) + (remainingH > 0 ? ' | 剩余 ' + remainingH.toFixed(1) + 'h' : '') : '',
  ].join('\n') }});
  elements.push({ tag: 'hr' });

  // ====== 核心指标 (累计 + 快照差值) ======
  //
  // ━ 累计 ━
  // 消耗       spend (allData.accountSpend)                 API: collectAllData → totalMetrics.stat_cost
  // CPL        avgCPA (spend / totalConversions)
  // 转化       totalConversions                             API: pageSummary.conversions = convert_cnt
  // 开口成本   spend / totalPrivateMsgOpen                  计算: 每产生一次开口对话的平均消耗
  // 开口留资率 openRetainRate = privateMsgRetain / open * 100%
  //                                                         API: message_action → 开口
  //                                                              clue_message_count → 留资
  // ━ 近*snapMin*分差值 ━
  // 新增消耗   spend15m = spend - snapshot15m.accountSpend  快照差值
  // 新增线索   snapConv = conv - snapshot15m.totalConv      快照差值
  // CPL        spend15m / snapConv                         回退: rolling.last5min / rolling.convLast5min
  // CPM        spend15m / imp15m * 1000                    回退: avgCPM (整体CPM)
  // 停留率     deltaRetention = dViews / dOver1Min * 100   回退: viewRetention (累计)
  // 速度       snapSpeed = spend15m / snapMinutes
  const metricsContent = [
    '━ **累计** ━',
    '💰 **消耗**: ¥' + spend.toFixed(0) + ' | CPL ¥' + (avgCPA > 0 ? avgCPA.toFixed(0) : '--'),
    '🎯 **转化**: ' + totalConversions + '条',
    '📨 **开口成本**: ¥' + (totalPrivateMsgOpen > 0 ? (spend / totalPrivateMsgOpen).toFixed(1) : '--') + ' | **开口留资率**: ' + openRetainRate.toFixed(1) + '%',
    '━ **近' + snapMinutes + '分差值** ━',
    '📊 **新增消耗**: +¥' + spend15m.toFixed(0) + ' | **新增线索**: +' + snapConv + '条',
    '📈 **CPL**: ¥' + (snapConv > 0 ? (spend15m / snapConv).toFixed(0) : rolling.last5min > 0 && rolling.convLast5min > 0 ? (rolling.last5min / rolling.convLast5min).toFixed(0) : '--') + ' | **CPM**: ¥' + (spend15m > 0 && imp15m > 0 ? (spend15m / imp15m * 1000).toFixed(1) : avgCPM.toFixed(1)) + ' | **停留率**: ' + (totalLiveViews > 0 ? deltaRetention.toFixed(1) + '%' : 'N/A'),
    '⚡ **速度**: ¥' + snapSpeed.toFixed(0) + '/min | 有消耗 ' + spendingCampaigns.length + '条 · 投放中 ' + activeCampaigns.length + '条 (起量' + rampingCount + '·掉量' + droppingCount + ')',
  ];
  if (budget > 0) metricsContent.push('🏦 **账户预算**: ¥' + spend.toFixed(0) + ' / ¥' + budget.toFixed(0) + ' (' + budgetPct.toFixed(0) + '%)');
  if (balance > 0) metricsContent.push('💳 **账户余额**: ¥' + balance.toFixed(0) + (daysRemaining > 0 ? ' (约' + daysRemaining.toFixed(1) + '天)' : ''));
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: metricsContent.join('\n') }});

  if (yesterdayLines.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: yesterdayLines.join('\n') }});
  }
  if (trendLines) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '📈 **消耗环比趋势**:\n' + trendLines }});
  }
  if (topLines.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: topLines.join('\n') }});
  }
  elements.push({ tag: 'hr' });
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: '🕐 ' + nowLocale + ' · ' + timeSlot + ' · 5分钟轮询采集' }] });

  const headerTitle = budget > 0 ? '📊 极狐直播 · 消耗 ¥' + spend.toFixed(0) + ' (' + budgetPct.toFixed(0) + '%)' + ' · ' + timeSlot : '📊 极狐直播 · ' + timeSlot;
  const detailedCard = { config: { wide_screen_mode: true }, header: { title: { tag: 'plain_text', content: PM2_PREFIX + headerTitle }, template: headerColor }, elements: elements };
  const result = await pushCard(larkCli, detailedCard, FEISHU_CHAT_ID, { timeoutMs: 20000, maxRetries: 1, circuitFailureThreshold: 2, circuitFailureWindow: 4, circuitOpenDurationMs: 60_000 });
  if (result.ok) { console.log('  📨 15分钟详细卡片已推送'); return true; }
  console.log('  ❌ 详细卡片推送异常:', result.error || 'unknown'); return false;
}

// ====== 主流程 ======
async function main() {
  if (OEC_FORCE || OEC_DRY_RUN) {
    console.log(`  🧪 测试模式: OEC_FORCE=${OEC_FORCE} OEC_DRY_RUN=${OEC_DRY_RUN}`);
  }

  // 跳过 15分钟整点时刻（避免与完整汇报刷新冲突）
  const min = new Date().getMinutes();
  const skipMins = [0, 15, 30, 45];
  if (!OEC_FORCE && skipMins.includes(min)) {
    console.log(`  ⏭ 跳过整点时刻(${pad(min)}分)，由15分钟汇报覆盖`);
    return;
  }
  if (OEC_FORCE && skipMins.includes(min)) {
    console.log(`  🧪 OEC_FORCE=1 强制绕过整点跳过 (${pad(min)}分)`);
  }

  // 推播时段限制：动态读取排班窗口（与15分钟脚本一致）
  const hour = new Date().getHours();
  const minute = new Date().getMinutes();
  const shiftWin = getTodayShiftWindow();
  const winStartMin = (shiftWin.startHour || 7) * 60 + (shiftWin.startMinute || 0);
  const winEndMin = (shiftWin.endHour || 23) * 60 + (shiftWin.endMinute || 0);
  const nowMin = hour * 60 + minute;
  if (!OEC_FORCE && (nowMin < winStartMin || nowMin >= winEndMin)) {
    console.log(`  🌙 非直播时段 (${hour}:${pad(minute)}，窗口 ${shiftWin.startHour}:${pad(shiftWin.startMinute||0)}-${shiftWin.endHour}:${pad(shiftWin.endMinute||0)})，静默`);
    return;
  }
  if (OEC_FORCE && (nowMin < winStartMin || nowMin >= winEndMin)) {
    console.log(`  🧪 OEC_FORCE=1 强制绕过非直播时段 (${hour}:${pad(minute)})`);
  }

  console.log(`\n[${timeStr()}] ⏱ 5分钟轻量速报启动 (v4)`);
  
  let data = null;
  
  // --- 主方案：HTTP API (秒级) ---
  try {
    const apiClient = await createApiClient({ useCache: true });
    const [stats, projectsPage] = await Promise.all([
      getDashboardStats(apiClient),
      getProjects(apiClient, { page: 1, pageSize: 50 }), // 拉汇总行+投放中计数
    ]);
    if (stats && stats.todaySpend > 0) {
      const totalConv = parseInt(String(projectsPage?.totalMetrics?.convert_cnt || '0').replace(/,/g, '')) || 0;
      const totalImp = parseInt(String(projectsPage?.totalMetrics?.show_cnt || '0').replace(/,/g, '')) || 0;
      const liveViews = parseInt(String(projectsPage?.totalMetrics?.luban_live_enter_cnt || '0').replace(/,/g, '')) || 0;
      const liveOver1Min = parseInt(String(projectsPage?.totalMetrics?.live_watch_one_minute_count || '0').replace(/,/g, '')) || 0;
      // 从 projects 列表中统计投放中项目数
      const projects = projectsPage?.projects || [];
      const activeCnt = projects.filter(p => {
        const s = p.project_status_name || p.project_status_first_name || '';
        return s === '启用' || s === '启用中' || s === '投放中';
      }).length;
      data = {
        accountSpend: stats.todaySpend,
        accountBudget: stats.todayBudget,
        accountBalance: stats.balance,
        summarySpend: stats.todaySpend,
        totalConv,
        activeCount: activeCnt,
        spendingCount: 0,
        impressions: totalImp,
        liveViews,
        liveOver1Min,
        time: new Date().toISOString(),
        _method: 'http_api',
      };
      console.log(`  ✅ HTTP API: 消耗 ¥${stats.todaySpend.toFixed(0)} | 预算 ¥${stats.todayBudget} | 转化 ${totalConv} | 投放中 ${activeCnt}`);
    }
  } catch (e) {
    console.log(`  ⚠ HTTP API 失败: ${e.message?.slice(0, 60)}`);
  }
  
  // --- 降级: CDP (保留但仅在HTTP失败时) ---
  if (!data) {
    console.log('  🔄 降级到 CDP...');
    const { quickConnect } = await import('./cdp-client.mjs');
    const { sleep, waitForToolbar, waitForPageReady } = await import('./wait-utils.mjs');
    const { calibratePage } = await import('./calibrate-page.mjs');
    
    const connResult = await quickConnect({ cmdTimeout: 15000, heartbeatInterval: 60000 });
    if (!connResult) { console.log('  ❌ CDP连接失败'); return; }
    
    const { client } = connResult;
    try {
      await client.evalJs('location.reload(true)');
      await sleep(4000);
      await waitForPageReady(client, 10000);
      await calibratePage(client, { dateRetries: 2, searchRetries: 1, statusRetries: 1, sortRetries: 1 });
      
      const toolbarReady = await waitForToolbar(client, 8000);
      
      const dataStr = await client.evalJs('(function(){let a=0,b=0,c=0;var t=document.querySelector(\".oc-promotion-tool-bar\");if(t){var k=t.querySelectorAll(\".oc-promotion-tool-bar-key-value\");for(var i=0;i<k.length;i++){var s=k[i].querySelectorAll(\"span\");var l=s[0]?s[0].textContent.trim():\"\";var v=s[3]?s[3].textContent.trim():\"\";var n=parseFloat(v.replace(/,/g,\"\"))||0;if(l.indexOf(\"日消耗\")>=0)a=n;else if(l.indexOf(\"日预算\")>=0)b=n;else if(l.indexOf(\"账户余额\")>=0)c=n}}return JSON.stringify({accountSpend:a,accountBudget:b,accountBalance:c,time:new Date().toISOString()})})()')
      const parsed = JSON.parse(dataStr || '{}');

      // 额外抓取汇总行转化数 + 投放中计划数（此前CDP降级遗漏了这两个字段，始终为0）
      const tableDataStr = await client.evalJs('(function(){let totalConv=0,activeCount=0;try{var sr=document.querySelector("tr.ovui-t-summary");if(sr){var sc=sr.querySelectorAll("th,td");totalConv=parseInt((sc[9]?.textContent||"0").replace(/,/g,""))||0}}catch(e){}try{var rows=document.querySelectorAll("tbody tr");for(var i=0;i<rows.length;i++){var cells=rows[i].querySelectorAll("td");if(cells.length<10)continue;var status=(cells[4]?.textContent||"").trim();if(status.indexOf("投放中")>=0||status.indexOf("启用中")>=0||status==="启用")activeCount++}}catch(e){}return JSON.stringify({totalConv:totalConv,activeCount:activeCount})})()');
      const tableParsed = JSON.parse(tableDataStr || '{}');

      data = { ...parsed, summarySpend: parsed.accountSpend, totalConv: tableParsed.totalConv || 0, activeCount: tableParsed.activeCount || 0, spendingCount: 0, impressions: 0, liveViews: 0, liveOver1Min: 0, _method: 'cdp' };
      console.log(`  ✅ CDP: 消耗 ¥${parsed.accountSpend?.toFixed(0)||0} | 转化 ${data.totalConv} | 投放中 ${data.activeCount}`);
    } finally { client.close(); }
  }

  // 3. 加载最近3次5分钟快照
  const prevSnapshots = loadRecent5minSnapshots(3);

  // ====== CDP降级数据修正 ======
  // 转化数只会增长不会归零，CDP偶发提取失败返回0时沿用最近有效值
  // 避免 HTTP API 恢复后 convLast5min 出现虚高增量（如 122-0=+122）
  if (!data.totalConv && prevSnapshots.length > 0) {
    const lastValid = prevSnapshots.find(s => s.totalConv > 0);
    if (lastValid) {
      console.log(`  🔧 转化数异常(0→${lastValid.totalConv})，${data._method === 'cdp' ? 'CDP提取失败' : 'API数据回退'}，沿用最近有效值`);
      data.totalConv = lastValid.totalConv;
    }
  }
  // CDP完全失败(消耗也为0)时跳过快照保存和推送，避免污染环比基线
  // v4.1: 消耗为0也会触发跳过，不再要求转化也为0（CDP可能从表格提取到转化但从工具栏提取不到消耗）
  // 有前序有效消耗且当前消耗归零 → 判定为数据损坏，跳过并沿用最近有效消耗作展示
  let skipSnapshot = false;
  if (data._method === 'cdp' && !data.accountSpend && prevSnapshots.length > 0) {
    const lastValid = prevSnapshots.find(s => s.accountSpend > 0);
    if (lastValid) {
      console.log(`  ⚠ CDP消耗异常归零(${lastValid.accountSpend.toFixed(0)}→0)，跳过快照以保护环比基线; 转化=${data.totalConv || 0}`);
      skipSnapshot = true;
      // 用最近有效消耗修正展示值（避免飞书卡片显示"今日累计: ¥0"）
      data.accountSpend = lastValid.accountSpend;
      data.summarySpend = lastValid.accountSpend;
    }
  }

  const rolling = calcRolling(data, prevSnapshots);

  // 与"近X分钟消耗"同一快照窗口算 CPM (消耗增量 / 展示增量 × 1000)
  const baseSnap = prevSnapshots[0];
  const recentImp = baseSnap && data.impressions > baseSnap.impressions ? data.impressions - baseSnap.impressions : 0;
  data._recentCPM = rolling.last5min > 0 && recentImp > 0 ? (rolling.last5min / recentImp * 1000) : 0;
  
  console.log(`  累计消耗: ¥${getSpend(data).toFixed(0)} | 近${Math.round(rolling.last5minMinutes || 5)}分钟: ¥${rolling.last5min.toFixed(0)} | 投放中: ${data.activeCount}`);
  
  // 4. 保存当前快照（CDP完全失败时跳过）
  if (!skipSnapshot) {
    // 双通道独立写入: JSON 失败不阻塞 SQLite
    const snapData = { ...data, _rolling: rolling };
    try {
      atomicWriteAtomic(
        path.join(DATA_DIR, `5m-${nowISO()}.json`),
        JSON.stringify(snapData, null, 2)
      );
    } catch (e) {
      console.warn(`  ⚠ JSON 快照写入失败: ${e.message}`);
    }
    // SQLite 双写 (5min-check 无 campaign 明细，writer 会自动跳过；保持双通道一致性)
    try {
      const r = insertSnapshot(snapData);
      if (r.ok && r.rows > 0) {
        console.log(`  📊 SQLite双写: ${r.rows} 条`);
      }
    } catch (e) {
      console.warn(`  ⚠ SQLite 双写失败: ${e.message}`);
    }
  }
  
  // 5. 推送到飞书（最小间隔1分钟，避免刷屏；CDP完全失败时跳过）
  if (!skipSnapshot) {
    const lastPushFile = path.join(DATA_DIR, 'last-5m-push.json');
    let shouldPush = true;
    try {
      if (fs.existsSync(lastPushFile)) {
        const last = JSON.parse(fs.readFileSync(lastPushFile, 'utf-8'));
        const elapsed = (Date.now() - (last.timestamp || 0)) / 60000;
        if (elapsed < 1) {
          shouldPush = false;
          console.log(`  ⏭ 距上次5分钟推送仅 ${elapsed.toFixed(1)} 分钟，跳过`);
        }
      }
    } catch {}
    if (shouldPush) {
      const now = new Date();
      const minute = now.getMinutes();
      const isQuarterHour = (minute % 15 === 0);

      if (isQuarterHour) {
        console.log('  📊 整刻钟 — 推送15分钟详细卡片');
        await pushDetailedCard();
      } else {
        await pushToLark(data, rolling);
      }
      atomicWriteAtomic(lastPushFile, JSON.stringify({ timestamp: Date.now() }));
    }
  }

  console.log(`[${timeStr()}] ✅ 完成`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
