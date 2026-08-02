// src/domain/parse-utils.mjs - 数字/快照解析工具（纯逻辑）

export function parsePlanBudget(budgetStr) {
  if (!budgetStr) return 0;
  if (typeof budgetStr === 'number') return budgetStr;
  const s = String(budgetStr);
  const m = s.match(/[\d,]+\.?\d*/);
  if (!m) return 0;
  return parseFloat(m[0].replace(/,/g, '')) || 0;
}

export function parseSnapshotTime(filename) {
  try {
    const ts = filename.replace('.json', '').replace('T', ' ').replace(/-/g, (m, i) => i >= 10 ? ':' : m);
    return new Date(ts + 'Z').getTime();
  } catch {
    return 0;
  }
}
