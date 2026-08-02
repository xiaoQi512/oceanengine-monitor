// src/services/daily-report-slots.mjs - 日报分时段增量构建

export const DAILY_REPORT_SLOT_ORDER = ['🌅 冷启动', '☀️ 早高峰', '🔥 午高峰', '🌤 午后', '🌆 晚高峰', '🌙 夜收尾'];

export function buildSlotLines({ entries, finalSpend, getSlotKeyFn }) {
  const slotLastEntry = {};
  entries.forEach(e => {
    const k = getSlotKeyFn(e);
    if (!slotLastEntry[k] || new Date(slotLastEntry[k].time) < new Date(e.time)) {
      slotLastEntry[k] = e;
    }
  });
  let prevSlotSpend = 0;
  const lines = [];
  for (const slot of DAILY_REPORT_SLOT_ORDER) {
    const entry = slotLastEntry[slot];
    if (!entry) continue;
    const slotSpend = (entry.totalSpend || 0) - prevSlotSpend;
    prevSlotSpend = entry.totalSpend || 0;
    const slotPct = finalSpend > 0 ? (slotSpend / finalSpend * 100) : 0;
    lines.push(`${slot} → ¥${slotSpend.toLocaleString()}（${slotPct.toFixed(0)}%）`);
  }
  return lines;
}
