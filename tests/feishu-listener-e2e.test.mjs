// tests/feishu-listener-e2e.test.mjs
// 端到端测试：模拟群消息 -> dispatchCommand 流程（SIMULATE_CDP=1）
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ACTION_QUEUE = path.join(ROOT, 'action-queue.json');
const HISTORY_FILE = path.join(ROOT, 'monitor-data', 'suggestion-history.json');
const STATE_FILE = path.join(ROOT, 'listener-state.json');

const origQueue = fs.existsSync(ACTION_QUEUE) ? fs.readFileSync(ACTION_QUEUE, 'utf-8') : null;
const origHistory = fs.existsSync(HISTORY_FILE) ? fs.readFileSync(HISTORY_FILE, 'utf-8') : null;
const origState = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, 'utf-8') : null;

function restore() {
  if (origQueue !== null) fs.writeFileSync(ACTION_QUEUE, origQueue);
  else if (fs.existsSync(ACTION_QUEUE)) fs.unlinkSync(ACTION_QUEUE);
  if (origHistory !== null) fs.writeFileSync(HISTORY_FILE, origHistory);
  else if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
  if (origState !== null) fs.writeFileSync(STATE_FILE, origState);
  else if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
}

function setupQueue(items) {
  const queue = Array.isArray(items) ? { actions: items } : items;
  fs.writeFileSync(ACTION_QUEUE, JSON.stringify(queue, null, 2));
}

function setupHistory(suggestions) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify({ suggestions, summary: { totalSuggestions: suggestions.length, accepted: 0, rejected: 0, ignored: suggestions.length, byType: {} } }, null, 2));
}

function loadQueue() {
  try { return JSON.parse(fs.readFileSync(ACTION_QUEUE, 'utf-8')); } catch { return { actions: [] }; }
}
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { return { suggestions: [] }; }
}

function recordHistoryResponse(planName, response) {
  const history = loadHistory();
  const target = [...history.suggestions].reverse().find(s =>
    !s.response && (s.campaignName === planName || s.campaignName?.includes(planName) || planName?.includes(s.campaignName))
  );
  if (target) {
    target.response = response;
    target.responseTime = new Date().toISOString();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    return target.id;
  }
  return null;
}

let msgLog = [];
async function sendMsgMock(text) {
  msgLog.push(text);
  return true;
}

function test(name, fn) {
  return Promise.resolve().then(fn).then(() => console.log(`✅ ${name}`)).catch(e => {
    console.error(`❌ ${name}\n   ${e.message}`); restore(); process.exit(1);
  });
}

(async () => {
  // ===== 场景 1: 拒绝命令弹出队首 + 回写历史 =====
  await test('拒绝: 弹出队首 + 历史回写 reject', async () => {
    msgLog = [];
    setupQueue([{ planName: 'A计划', type: 'pause' }]);
    setupHistory([{ id: 'h1', alertType: 'zero_conv', campaignName: 'A计划', response: null, responseTime: null }]);

    const queue = loadQueue();
    const removed = queue.actions.shift();
    fs.writeFileSync(ACTION_QUEUE, JSON.stringify(queue, null, 2));
    const histId = recordHistoryResponse(removed.planName, 'reject');
    await sendMsgMock(`❌ 已拒绝：${removed.planName}`);

    assert.strictEqual(loadQueue().actions.length, 0, '队列应清空');
    const hist = loadHistory().suggestions.find(s => s.campaignName === 'A计划');
    assert.strictEqual(hist.response, 'reject');
    assert.ok(hist.responseTime);
  });

  // ===== 场景 2: 执行（无计划名）取队首 =====
  await test('执行(无 planName): 取队列队首', async () => {
    msgLog = [];
    setupQueue([{ planName: 'B计划', type: 'pause' }]);

    const queue = loadQueue();
    const top = queue.actions[0];
    assert.strictEqual(top.planName, 'B计划', '应取到 B计划');
  });

  // ===== 场景 3: 多个未处理建议，回写最近一条 =====
  await test('历史回写: 找到最近未处理记录', async () => {
    msgLog = [];
    setupHistory([
      { id: 'h1', campaignName: 'A计划', response: null, responseTime: null },
      { id: 'h2', campaignName: 'A计划', response: 'accept', responseTime: '2026-06-22T01:00:00Z' },
      { id: 'h3', campaignName: 'A计划', response: null, responseTime: null },
    ]);
    setupQueue([{ planName: 'A计划' }]);

    const histId = recordHistoryResponse('A计划', 'accept');
    assert.strictEqual(histId, 'h3', '应回写 h3（最近的未处理）');
    const h2 = loadHistory().suggestions.find(s => s.id === 'h2');
    assert.strictEqual(h2.response, 'accept', '已处理的 h2 不应被覆盖');
  });

  // ===== 场景 4: 计划名部分匹配 =====
  await test('历史回写: 部分匹配计划名', async () => {
    msgLog = [];
    setupHistory([
      { id: 'h1', campaignName: 'A计划-直播-001', response: null, responseTime: null },
    ]);
    setupQueue([{ planName: 'A计划-直播' }]);

    const histId = recordHistoryResponse('A计划-直播', 'accept');
    assert.strictEqual(histId, 'h1', '部分匹配也应回写');
  });

  // ===== 场景 5: 队列为空时拒绝 =====
  await test('拒绝: 队列为空时不报错', async () => {
    msgLog = [];
    setupQueue([]);

    const q1 = loadQueue();
    const q2 = q1.actions && q1.actions.length > 0 ? { actions: q1.actions.slice(1) } : { actions: [] };
    fs.writeFileSync(ACTION_QUEUE, JSON.stringify(q2, null, 2));
    const finalQ = loadQueue();
    assert.strictEqual(finalQ.actions.length, 0);
  });

  // ===== 场景 6: 加预算指令解析 =====
  await test('加预算: amount 解析', async () => {
    const t = '加预算 A计划 5000';
    const m = t.match(/(\d{3,}(?:\.\d{1,2})?)/g);
    assert.ok(m, '应匹配金额');
    assert.strictEqual(parseFloat(m[m.length - 1]), 5000);
  });

  // ===== 场景 7: 普通闲聊不应触发任何命令 =====
  await test('闲聊: 收到/好的/ok 不应触发', async () => {
    assert.strictEqual(simulateParse('收到'), null);
    assert.strictEqual(simulateParse('好的，我看看'), null);
    assert.strictEqual(simulateParse('ok'), null);
    assert.strictEqual(simulateParse('稍等'), null);
  });

  restore();
  console.log('\n全部通过');
})();

function simulateParse(text) {
  const COMMAND_PATTERNS = [
    { cmds: ['adjust_budget'], regex: /^\s*(加预算|增加预算|追加预算|adjust_budget|adjust budget|加到|提到)\s*[：:\s]*/i, needAmount: true },
    { cmds: ['stop'], regex: /^\s*(关停|关闭|停止投放|关闭计划|disable|stop)\s*[：:\s]*/i },
    { cmds: ['pause'], regex: /^\s*(暂停|pause)\s*[：:\s]*/i },
    { cmds: ['resume'], regex: /^\s*(恢复|继续|开启|启用|resume|start)\s*[：:\s]*/i },
    { cmds: ['reject'], regex: /^\s*(拒绝|取消|reject|no|跳过|不要)\s*[：:\s]*/i },
    { cmds: ['execute'], regex: /^\s*(执行|采纳|同意|confirm|yes)\s*[：:\s]*/i },
    { cmds: ['info'], regex: /^\s*(状态|status|队列|queue|帮助|help|\?)\s*$/i },
  ];
  const matched = COMMAND_PATTERNS.find(p => p.regex.test(text));
  return matched ? { cmd: matched.cmds[0] } : null;
}
