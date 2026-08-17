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
    // 兼容带 accountId 前缀与不带前缀的快照文件名
    // 例: 2026-08-17T02-30-05.json 与 1842681352509635-2026-08-17T02-30-05.json
    const m = String(filename).match(/(\d{4}-\d{2}-\d{2})T(\d{2}-\d{2}-\d{2})\.json$/);
    if (!m) return 0;
    const ts = `${m[1]} ${m[2]}`.replace(/-/g, (mm, i) => i >= 10 ? ':' : mm);
    return new Date(ts + 'Z').getTime();
  } catch {
    return 0;
  }
}
