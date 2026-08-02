// src/domain/quick-card.mjs - 5min 速报卡片构建（纯逻辑）
import { getSpend, getConv } from './rolling.mjs';
import { buildTop5DeltaLines } from './quick-card-top.mjs';

export function buildQuickCard(
  data,
  rolling,
  prevSnapshots = [],
  { pm2Prefix = '', now = '' } = {}
) {
  const trendLines = rolling.windows.map(w => {
    const dir = parseFloat(w.pct) > 0 ? '↑' : parseFloat(w.pct) < 0 ? '↓' : '→';
    const hot = w.hot ? ' 🔥' : '';
    const sign = w.delta >= 0 ? '+' : '';
    return `${w.label}: ${dir}${Math.abs(parseFloat(w.pct)).toFixed(0)}% (${sign}¥${w.delta.toFixed(0)}) · ¥${w.rpm.toFixed(0)}/min${hot}`;
  }).join('\n');

  const top5Lines = buildTop5DeltaLines(data, prevSnapshots);

  return {
    config: { wide_screen_mode: false },
    header: {
      title: { tag: 'plain_text', content: `${pm2Prefix}⏱ 5分钟速报 · ${now}` },
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
            ``,
            `🏆 **5min消耗TOP5**:`,
            `${top5Lines}`,
          ].join('\n')
        }
      }
    ]
  };
}
