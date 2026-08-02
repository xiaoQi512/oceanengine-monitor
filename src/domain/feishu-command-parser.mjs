// src/domain/feishu-command-parser.mjs - 飞书命令解析与消息识别（纯逻辑）

export const CMD_RULES = [
  {
    id: 'adjust_budget',
    re: /^\s*(加预算|增加预算|追加预算|adjust\s*budget)\s*/i,
    needAmount: true,
  },
  { id: 'stop', re: /^\s*(关停|关闭\s*计划|停止投放|stop|disable)\s*/i },
  { id: 'pause', re: /^\s*(暂停|pause)\s*/i },
  { id: 'resume', re: /^\s*(恢复|开启|启用|继续|resume|start)\s*/i },
  { id: 'reject', re: /^\s*(拒绝|取消|跳过|reject|no)\s*/i },
  { id: 'execute', re: /^\s*(执行|采纳|同意|confirm|yes)\s*/i },
  { id: 'info', re: /^(状态|status|队列|queue|帮助|help|\?)$/i },
];

export function msgText(msg) {
  try {
    const c$ = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
    return (c$.text || '').trim();
  } catch (e) {
    if (typeof msg.content === 'string') return msg.content.trim();
    if (msg.content && msg.content.text) return msg.content.text.trim();
    return '';
  }
}

export function isBotMsg(msg, text, { botAppId = '' } = {}) {
  return (msg.sender?.id === botAppId)
    || (msg.sender?.sender_type === 'app')
    || (msg.sender?.id_type === 'app_id')
    || /^(✅|❌|ℹ️|⚠️|💬|📋|🧪|📁|🔵|\[listener\]|\[bot\])/.test(text);
}

export function isAtMention(msg, text, { botAppId = '' } = {}) {
  if (text.indexOf(botAppId) >= 0) return true;
  try {
    const c$ = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
    if (c$.mentions) {
      for (const mi of c$.mentions) {
        if (mi.id === botAppId || mi.key === botAppId) return true;
      }
    }
  } catch (e) {}
  if (/@\u5c0f\u4e03/.test(text)) return true;
  return false;
}

export function cleanAtText(text) {
  return text.replace(/<at[^>]*>[^<]*<\/at>/gi, '').replace(/@\u5c0f\u4e03\s*/g, '').trim();
}

export function parseCommand(msg, { botAppId = '' } = {}) {
  const text = msgText(msg);
  if (!text) return null;
  const rule = CMD_RULES.find(r => r.re.test(text));
  if (!rule) return null;
  let amount = null;
  if (rule.needAmount) {
    const m = text.match(/(\d{3,}(?:\.\d{1,2})?)/g);
    if (m) amount = parseFloat(m[m.length - 1]);
  }
  const planName = extractPlanName(text, rule.id, amount);
  return { cmd: rule.id, planName, amount, raw: text.slice(0, 200) };
}

export function extractPlanName(text, cmd, amount) {
  let m = text.match(/[「"'](.+?)[」"']/);
  if (m) return m[1].trim();

  m = text.match(/(?:^|\s)(?:计划名|计划|plan|名|名字)[：:\s]+([^\s「」"'，,。]+)/i);
  if (m) return m[1].trim();

  const rule = CMD_RULES.find(r => r.id === cmd);
  let tail = text.replace(rule.re, '').trim();

  if (cmd === 'adjust_budget' && amount !== null) {
    const words = tail.split(/\s+/);
    for (let i = words.length - 1; i >= 0; i--) {
      const n = parseFloat(words[i]);
      if (!isNaN(n) && n >= 100) {
        words.splice(i, 1);
        break;
      }
    }
    tail = words.join(' ').trim();
  }

  tail = tail.replace(/[，,。！!?？]+$/, '').trim();
  if (tail && !/^(状态|status|队列|queue|帮助|help|\?)$/i.test(tail)) return tail;
  return null;
}
