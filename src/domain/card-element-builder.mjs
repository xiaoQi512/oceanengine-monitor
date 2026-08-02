// src/domain/card-element-builder.mjs - 飞书卡片元素组装

export function buildCardElements({
  pacingLines,
  metricsLines,
  alertLines,
  topLines,
  budgetExceededContent,
  rampingUp,
  yoyContent,
  multiDayContent,
  lifecycleContent,
  advice,
  insight,
  enableHtmlReport,
  now,
  d,
  liveWin,
}) {
  const elements = [];
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: pacingLines.join('\n') } });
  elements.push({ tag: 'hr' });
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: metricsLines.join('\n') } });
  elements.push({ tag: 'hr' });
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: alertLines.join('\n') } });
  if (budgetExceededContent) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: budgetExceededContent } });
  }
  if (topLines.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: topLines.join('\n') } });
  }
  if (rampingUp.length > 0) {
    const trendLines = [`🔥 起量: ${rampingUp.slice(0, 3).map(c => c.name.slice(0, 25) + '+' + (c.changeRate*100).toFixed(0) + '%').join(', ')}`];
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: trendLines.join('\n') } });
  }
  if (yoyContent) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: yoyContent } });
  }
  if (multiDayContent) elements.push({ tag: 'div', text: { tag: 'lark_md', content: multiDayContent } });
  if (lifecycleContent) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: lifecycleContent } });
  }
  elements.push({ tag: 'hr' });
  if (advice) elements.push({ tag: 'div', text: { tag: 'lark_md', content: `💡 **盯盘建议**: ${advice}` } });
  if (insight) elements.push({ tag: 'div', text: { tag: 'lark_md', content: insight } });
  elements.push({ tag: 'hr' });
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: enableHtmlReport ? ' 详实报表已发送为HTML文件，可在群聊中下载查看' : ' 详实报表已关闭，仅展示关键摘要' }] });
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: `🕐 ${now} · ${d.timeSlot || ''} · ${liveWin.labelCompact} · 点击按钮反馈建议` }] });
  return elements;
}
