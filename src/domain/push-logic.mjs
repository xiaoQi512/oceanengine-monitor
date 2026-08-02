// src/domain/push-logic.mjs - 飞书推送决策
export function shouldPush(analysis, { loadLastPush, now = Date.now(), noThrottle = process.env.OEC_NO_THROTTLE === '1' } = {}) {
  const alerts = analysis.alerts || [];
  const hasData = (analysis.summary?.totalSpending ?? 0) > 0 || (analysis.summary?.totalSpend ?? 0) > 0;
  if (!hasData) {
    return { push: false, level: 0, reason: '页面数据为空(0计划/0消耗)，可能是表格未加载' };
  }

  const highCount = alerts.filter(a => a.severity === 'high').length;
  const midCount = alerts.filter(a => a.severity === 'medium').length;
  const last = loadLastPush ? loadLastPush() : {};
  const elapsed = now - (last.timestamp || 0);
  const MIN_INTERVAL_MS = noThrottle ? 0 : (3 * 60 * 1000);

  if (!noThrottle && elapsed < MIN_INTERVAL_MS) {
    return { push: false, level: 0, reason: `距上次推送仅 ${(elapsed / 60000).toFixed(1)} 分钟，需间隔≥3分钟` };
  }

  if (highCount > 0) {
    return { push: true, level: 1, reason: `严重告警 ${highCount} 条` };
  }

  if (midCount > 0) {
    return { push: true, level: 2, reason: `中等告警 ${midCount} 条` };
  }

  return { push: true, level: 3, reason: '常规3分钟播报' };
}
