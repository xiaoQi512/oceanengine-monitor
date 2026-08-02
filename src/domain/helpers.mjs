// src/domain/helpers.mjs - 监控纯工具函数
import { makeBar } from './progress-bar.mjs';
export { parsePlanBudget, parseSnapshotTime } from './parse-utils.mjs';

export function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 滑动窗口线性回归斜率
export function computeLinearSlope(series) {
  const n = series.length;
  if (n < 3) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of series) {
    sumX += p.x; sumY += p.y;
    sumXY += p.x * p.y; sumX2 += p.x * p.x;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export function progressBar(pct) {
  return makeBar(pct);
}

export function getTimeSlotAdvice(timeSlot, budgetUsed, rampingCount, droppingCount) {
  const advices = {
    '冷启动期': '⏳ 检查各计划是否开始消耗，关注冷启动失败的0消耗计划，适当给量激活',
    '早高峰': '📈 流量上升期，关注CPA趋势，发现起量计划可适当放量，掉量计划及时补量',
    '午高峰': '🔥 全天流量高峰，盯紧TOP消耗计划的CPA，超过均值1.5x立即暂停，预算消耗应达40%',
    '午后平稳期': '🔍 清理零转化和高成本计划，观察掉量计划是否需要调整出价或定向，预算消耗应达55%',
    '晚高峰': '🌇 晚间流量回升，竞争加剧，注意CPA波动，保持核心计划稳定投放',
    '夜间收尾': budgetUsed > 0.90
      ? '⚡ 预算即将耗尽，控制消耗节奏，优先保高转化计划，预留余量应对突发'
      : budgetUsed > 0.75
      ? '🎯 预算使用中后段，关注高消耗低转化计划，夜间成本波动大需紧盯'
      : '🌙 关键收尾阶段，确保核心计划正常投放，预留10-15%预算应对夜场流量',
    '已结束': `📊 今日投放已结束，消耗 ${(budgetUsed*100).toFixed(0)}%，复盘高成本计划为明日优化做准备`,
  };
  return advices[timeSlot] || '';
}
