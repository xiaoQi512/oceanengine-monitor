// src/services/alert-cards.mjs - 余额/账户预算告警卡片构建
import { buildBalanceCardLines, buildAccountBudgetCardLines } from '../domain/alert-card-lines.mjs';

export function buildBalanceAlertCard({ analysis, worst, config, d = analysis.delta || {} }) {
  const isCritical = worst.severity === 'high';
  const headerColor = isCritical ? 'red' : 'orange';
  const statusIcon = isCritical ? '🔴' : '🟡';
  const urgencyLabel = isCritical ? '⚠️ 立即充值' : '⚡ 尽快充值';
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${statusIcon} 账户余额告警 · ${urgencyLabel}` },
      template: headerColor,
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: buildBalanceCardLines({ analysis, worst, d }).join('\n') } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `🔗 [打开投放管理页](${config.campaignUrl})  |  \`/充值\` 查看充值指引` } },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '💳 余额专用告警 · 独立于常规监控 · 每2小时最多推送1次（严重度升级除外）' }] },
    ],
  };
}

export function buildAccountBudgetAlertCard({
  analysis,
  config,
  d,
  severity,
  accountSpend,
  accountBudget,
  usedPct,
  projectedDaily,
  overSpend,
  isCritical,
  headerColor,
  statusIcon,
  urgencyLabel,
}) {
  const cardLines = buildAccountBudgetCardLines({
    analysis,
    d,
    accountSpend,
    accountBudget,
    usedPct,
    projectedDaily,
    overSpend,
    isCritical,
  });
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${statusIcon} 账户日预算告警 · ${urgencyLabel}` },
      template: headerColor,
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: cardLines.join('\n') } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `🔗 [打开投放管理页](${config.campaignUrl})  |  [查看完整报表](http://127.0.0.1:8899/report)` } },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '💰 账户日预算专用告警 · 独立于常规监控 · 每1小时最多推送1次（严重度升级除外）' }] },
    ],
  };
}
