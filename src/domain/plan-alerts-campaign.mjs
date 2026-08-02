// src/domain/plan-alerts-campaign.mjs - 计划级告警
import { parsePlanBudget } from './helpers.mjs';

export function buildCampaignAlerts(campaignDeltas = [], avgCPA = 0) {
  const alerts = [];
  for (const c of campaignDeltas) {
    if (c.spend > 50 && c.conversions === 0) alerts.push({ type: 'zero_conv', planName: c.name, name: `零转化消耗: ${c.name.slice(0, 35)}`, detail: `消耗 ¥${c.spend.toFixed(0)} 但零转化，是否需要暂停？`, severity: c.spend > 200 ? 'high' : 'medium', campaignId: c.id, needAction: true });
    if (c.cpa > avgCPA * 2.5 && c.spend > 30 && c.conversions > 0) alerts.push({ type: 'high_cpa', planName: c.name, name: `高成本计划: ${c.name.slice(0, 35)}`, detail: `CPL ¥${c.cpa.toFixed(2)} (均值 ¥${avgCPA.toFixed(2)}的 ${(c.cpa/avgCPA).toFixed(1)}x)，消耗 ¥${c.spend.toFixed(0)}，建议关停`, severity: c.spend > 100 ? 'high' : 'medium', campaignId: c.id });
    const planBudget = parsePlanBudget(c.budget);
    if (planBudget > 0 && c.spend >= planBudget * 0.8) {
      const exceedPct = ((c.spend / planBudget) * 100);
      alerts.push({ type: 'budget_cap', planName: c.name, name: c.spend >= planBudget ? `已撞线暂停: ${c.name.slice(0, 30)}` : `预算即将耗尽: ${c.name.slice(0, 30)}`, detail: c.spend >= planBudget ? `消耗 ¥${c.spend.toFixed(0)} 已达计划预算 ¥${planBudget.toFixed(0)} (${exceedPct.toFixed(0)}%)，已暂停投放，建议追加预算并手动恢复` : `消耗 ¥${c.spend.toFixed(0)} / 计划预算 ¥${planBudget.toFixed(0)} (${exceedPct.toFixed(0)}%)，接近上限建议追加`, severity: c.spend >= planBudget ? 'high' : 'medium', campaignId: c.id });
    }
  }
  return alerts;
}
