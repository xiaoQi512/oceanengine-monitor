// src/services/daily-report-core.mjs - 日报对比与卡片构建核心
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../utils/monitor-utils.mjs';

export function loadRecentLogs(days = 7, { dataDir = DATA_DIR, fsImpl = fs, pathImpl = path } = {}) {
  const results = [];
  const base = new Date();
  for (let i = 1; i <= days; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const file = pathImpl.join(dataDir, `daily-${dateStr}.json`);
    if (!fsImpl.existsSync(file)) continue;
    try {
      const log = JSON.parse(fsImpl.readFileSync(file, 'utf-8'));
      const entries = log.filter(e => !e.type || e.type !== 'data_gap');
      if (entries.length === 0) continue;
      const last = entries[entries.length - 1];
      results.push({
        date: dateStr,
        finalSpend: last.totalSpend || 0,
        finalConversions: last.totalConversions || 0,
        finalCPA: (last.totalConversions || 0) > 0 ? (last.totalSpend || 0) / last.totalConversions : 0,
        totalLeads: last.totalLeads || 0,
      });
    } catch {}
  }
  return results.sort((a, b) => a.date.localeCompare(b.date));
}

export function getSlotKey(entry) {
  // 时段按北京时间计算，避免 CI runner 时区影响日报分桶。
  const h = (new Date(entry.time).getUTCHours() + 8) % 24;
  if (h < 9) return '🌅 冷启动';
  if (h < 11) return '☀️ 早高峰';
  if (h < 14) return '🔥 午高峰';
  if (h < 17) return '🌤 午后';
  if (h < 20) return '🌆 晚高峰';
  return '🌙 夜收尾';
}

export function buildDailyReportCard({
  today,
  entries,
  gaps,
  freshData,
  finalSpend,
  effectiveBudget,
  budgetPct,
  finalConversions,
  totalLeads,
  finalCPA,
  openRetainStr,
  totalAlerts,
  slotLines,
  insightLines,
  now = new Date(),
}) {
  const card = {
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
          content: `**极狐-区域福利号-直播** | 16h直播(7-23) | ${entries.length}个采样点${gaps > 0 ? ' · ⚠断层' + gaps + '次' : ''}${freshData ? ' · ✅已终采' : ' · ⚠无终采'}`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `💰 **最终消耗** ¥${finalSpend.toLocaleString()} / ¥${effectiveBudget.toLocaleString()}（${budgetPct}%）\n🎯 **总转化** ${finalConversions}条 | **线索** ${totalLeads}条 | **CPA** ¥${finalCPA.toFixed(0)}\n📨 **开留率** ${openRetainStr} | 线索≈转化 ${Math.abs(totalLeads - finalConversions) <= 5 ? '✅' : 'ℹ️'}`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `⏰ **分时段消耗增量**\n${slotLines.join('\n')}`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `🔔 **今日告警** ${totalAlerts}次 | ⚠数据断层 ${gaps}次`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `🔍 **今日洞察**\n${insightLines.join('\n') || '今日数据平稳，无显著风险或亮点。'}`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [
          { tag: 'plain_text', content: `⏰ 生成时间: ${now.toLocaleString('zh-CN')} · 监控 Bot 自动生成` },
        ],
      },
    ],
  };
  return JSON.stringify(card);
}
