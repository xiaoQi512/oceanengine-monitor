// src/domain/five-min-context-pacing.mjs - 5min 上下文节奏计算

export function computeContextPacing({ shift, spend, budget, now }) {
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
  const daysRemaining = projectedDaily > 0 && budget > 0 ? budget / projectedDaily : 0;
  const pacingHealth = budgetPct > timePct * 1.3 ? '🔴 消耗超速' : budgetPct > timePct * 1.1 ? '🟡 消耗偏快' : budgetPct < timePct * 0.7 ? '🔵 消耗偏慢' : '✅ 节奏正常';
  const headerColor = budgetPct > timePct * 1.3 ? 'red' : budgetPct > timePct * 1.1 ? 'orange' : 'green';
  return { timeElapsedH, timeTotalH, timePct, budgetPct, projectedDaily, remainingH, daysRemaining, pacingHealth, headerColor };
}
