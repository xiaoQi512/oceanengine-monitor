// src/domain/pacing-analysis.mjs - 消耗节奏与时段分析（纯逻辑）

export function computePacing({
  now,
  dailyStartHour = 0,
  dailyStartMinute = 0,
  dailyEndHour = 24,
  dailyEndMinute = 0,
  effectiveBudget,
  totalSpend,
}) {
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const startH = dailyStartHour + (dailyStartMinute || 0) / 60;
  const endH = dailyEndHour + (dailyEndMinute || 0) / 60;
  const windowDuration = endH - startH;
  const elapsedHours = Math.max(0, Math.min(currentHour - startH, windowDuration));
  const timeProgress = Math.min(elapsedHours / windowDuration, 1);
  const idealSpend = timeProgress * effectiveBudget;
  const pacingRatio = idealSpend > 0 ? totalSpend / idealSpend : 0;
  const minutesElapsed = Math.max(elapsedHours * 60, 1);
  const avgSpeed = totalSpend / minutesElapsed;
  const remainingMinutes = Math.max((endH - Math.min(currentHour, endH)) * 60, 0);
  const projectedDaily = totalSpend + avgSpeed * remainingMinutes;
  let pacingHealth;
  if (pacingRatio >= 0.8 && pacingRatio <= 1.2) pacingHealth = 'good';
  else if (pacingRatio >= 0.6 && pacingRatio <= 1.5) pacingHealth = 'warning';
  else pacingHealth = 'danger';
  let timeSlot;
  if (currentHour < startH) timeSlot = '未开始';
  else if (currentHour < 9) timeSlot = '冷启动期';
  else if (currentHour < 11) timeSlot = '早高峰';
  else if (currentHour < 14) timeSlot = '午高峰';
  else if (currentHour < 17) timeSlot = '午后平稳期';
  else if (currentHour < 20) timeSlot = '晚高峰';
  else if (currentHour < endH) timeSlot = '夜间收尾';
  else timeSlot = '已结束';
  return { currentHour, windowDuration, elapsedHours, timeProgress, idealSpend, pacingRatio, projectedDaily, pacingHealth, timeSlot };
}
