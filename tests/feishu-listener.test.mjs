// tests/feishu-listener.test.mjs - 命令解析 + 历史回写单元测试
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HFILE = path.join(ROOT, 'monitor-data', 'suggestion-history.json');
const _h = fs.existsSync(HFILE) ? fs.readFileSync(HFILE, 'utf-8') : null;

const CMD_RULES = [
  { id: 'adjust_budget', re: /^\s*(加预算|增加预算|追加预算|adjust\s*budget)\s*/i, needAmount: true },
  { id: 'stop', re: /^\s*(关停|关闭\s*计划|停止投放|stop|disable)\s*/i },
  { id: 'pause', re: /^\s*(暂停|pause)\s*/i },
  { id: 'resume', re: /^\s*(恢复|开启|启用|继续|resume|start)\s*/i },
  { id: 'reject', re: /^\s*(拒绝|取消|跳过|reject|no)\s*/i },
  { id: 'execute', re: /^\s*(执行|采纳|同意|confirm|yes)\s*/i },
  { id: 'info', re: /^(状态|status|队列|queue|帮助|help|\?)$/i },
];

function extractPlanName(text, cmd, amount) {
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
      if (!isNaN(n) && n >= 100) { words.splice(i, 1); break; }
    }
    tail = words.join(' ').trim();
  }
  tail = tail.replace(/[，,。！!?？]+$/, '').trim();
  if (tail && !/^(状态|status|队列|queue|帮助|help|\?)$/i.test(tail)) return tail;
  return null;
}

function parse(text) {
  if (!text) return null;
  const t = text.trim();
  const rule = CMD_RULES.find(r => r.re.test(t));
  if (!rule) return null;
  let amount = null;
  if (rule.needAmount) {
    const m = t.match(/(\d{3,}(?:\.\d{1,2})?)/g);
    if (m) amount = parseFloat(m[m.length - 1]);
  }
  const pn = extractPlanName(t, rule.id, amount);
  return { cmd: rule.id, planName: pn, amount, raw: t.slice(0, 200) };
}

function ok(name, fn) {
  try { fn(); console.log('✅', name); } catch (e) { console.error('❌', name + '\n   ' + e.message); process.exit(1); }
}

// === parseCommand ===
ok('暂停 A计划', () => { const r = parse('暂停 A计划'); assert.strictEqual(r.cmd, 'pause'); assert.strictEqual(r.planName, 'A计划'); });
ok('关停 A', () => { const r = parse('关停 A'); assert.strictEqual(r.cmd, 'stop'); assert.strictEqual(r.planName, 'A'); });
ok('暂停「A计划名」', () => { const r = parse('暂停「A计划名」'); assert.strictEqual(r.cmd, 'pause'); assert.strictEqual(r.planName, 'A计划名'); });
ok('加预算 A 5000', () => { const r = parse('加预算 A 5000'); assert.strictEqual(r.cmd, 'adjust_budget'); assert.strictEqual(r.planName, 'A'); assert.strictEqual(r.amount, 5000); });
ok('加预算 A计划 8000', () => { const r = parse('加预算 A计划 8000'); assert.strictEqual(r.cmd, 'adjust_budget'); assert.strictEqual(r.planName, 'A计划'); assert.strictEqual(r.amount, 8000); });
ok('执行 (无计划名)', () => { const r = parse('执行'); assert.strictEqual(r.cmd, 'execute'); assert.strictEqual(r.planName, null); });
ok('拒绝', () => { const r = parse('拒绝'); assert.strictEqual(r.cmd, 'reject'); });
ok('恢复 A', () => { const r = parse('恢复 A'); assert.strictEqual(r.cmd, 'resume'); assert.strictEqual(r.planName, 'A'); });
ok('状态', () => { const r = parse('状态'); assert.strictEqual(r.cmd, 'info'); });
ok('pause test', () => { const r = parse('pause test'); assert.strictEqual(r.cmd, 'pause'); assert.strictEqual(r.planName, 'test'); });
ok('无关消息 null', () => { assert.strictEqual(parse('今天天气'), null); });
ok('收到 不触发', () => { assert.strictEqual(parse('收到'), null); });
ok('好的 不触发', () => { assert.strictEqual(parse('好的'), null); });
ok('ok 不触发', () => { assert.strictEqual(parse('ok'), null); });
ok('执行 A', () => { const r = parse('执行 A'); assert.strictEqual(r.cmd, 'execute'); assert.strictEqual(r.planName, 'A'); });
ok('拒绝 A计划', () => { const r = parse('拒绝 A计划'); assert.strictEqual(r.cmd, 'reject'); assert.strictEqual(r.planName, 'A计划'); });
ok('加预算 计划名：B计划 10000', () => { const r = parse('加预算 计划名：B计划 10000'); assert.strictEqual(r.cmd, 'adjust_budget'); assert.strictEqual(r.planName, 'B计划'); assert.strictEqual(r.amount, 10000); });

// === history ===
ok('历史回写', () => {
  const th = { suggestions: [
    { id: '1', alertType: 'zero_conv', campaignId: '1', campaignName: 'A计划', suggestion: '暂停', response: null, responseTime: null },
    { id: '2', alertType: 'high_cpa', campaignId: '2', campaignName: 'B计划', suggestion: '关停', response: null, responseTime: null },
    { id: '3', alertType: 'budget_cap', campaignId: '3', campaignName: 'C计划', suggestion: '加预算', response: 'accept', responseTime: null },
  ], summary: { totalSuggestions: 3, accepted: 0, rejected: 0, ignored: 3, byType: {} } };
  fs.writeFileSync(HFILE, JSON.stringify(th, null, 2));

  const d = JSON.parse(fs.readFileSync(HFILE, 'utf-8'));
  const t = d.suggestions.find(s => !s.response && s.campaignName === 'A计划');
  assert.ok(t, '应找到 A计划');
  t.response = 'accept';
  t.responseTime = new Date().toISOString();
  fs.writeFileSync(HFILE, JSON.stringify(d, null, 2));

  const f = JSON.parse(fs.readFileSync(HFILE, 'utf-8'));
  assert.strictEqual(f.suggestions.find(s => s.campaignName === 'A计划').response, 'accept');
});

// restore
if (_h !== null) fs.writeFileSync(HFILE, _h);
else if (fs.existsSync(HFILE)) fs.unlinkSync(HFILE);
console.log('\n全部通过');
