// src/domain/progress-bar.mjs - 文本进度条（纯逻辑）

export function makeBar(pct, barLen = 10) {
  const filled = Math.min(Math.round(pct / 100 * barLen), barLen);
  return '█'.repeat(filled) + '░'.repeat(barLen - filled);
}
