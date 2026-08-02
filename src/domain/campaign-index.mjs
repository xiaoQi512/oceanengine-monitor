// src/domain/campaign-index.mjs - 计划索引构建（纯逻辑）

export function buildCampaignIndex(campaigns) {
  const map = new Map();
  for (const c of campaigns) {
    map.set(c.id, c);
  }
  return map;
}
