// tests/feishu-listener-state.test.mjs - listener 队列与待办状态存储测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadQueue,
  saveQueue,
  enqueue,
  loadPending,
  savePending,
  addPending,
  findPending,
  removePending,
  getStateFile,
  loadState,
  saveState,
  checkDuplicateToday,
} from '../src/services/feishu-listener-state.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'listener-state-'));
try {
  const queueFile = path.join(dir, 'queue.json');
  const pendingFile = path.join(dir, 'pending.json');
  const stateFile = path.join(dir, 'listener-state.json');
  const stateFileAnchor = path.join(dir, 'listener-state-anchor.json');
  const stateOpts = {
    anchorChatId: 'anchor',
    stateFile,
    anchorStateFile: stateFileAnchor,
  };

  assert.deepStrictEqual(loadState('chat', stateOpts), { lastMsgId: null });
  saveState({ lastMsgId: 'm1' }, 'chat', stateOpts);
  assert.deepStrictEqual(loadState('chat', stateOpts), { lastMsgId: 'm1' });
  saveState({ lastMsgId: 'm2' }, 'anchor', stateOpts);
  assert.strictEqual(getStateFile('anchor', stateOpts), stateFileAnchor);
  assert.deepStrictEqual(loadState('anchor', stateOpts), { lastMsgId: 'm2' });

  const auditFile = path.join(dir, 'action-audit.jsonl');
  assert.strictEqual(checkDuplicateToday({ planName: '计划A', type: 'pause' }, { auditFile, init: () => {} }), null);
  fs.writeFileSync(auditFile, JSON.stringify({
    time: '2026-08-02T01:00:00Z',
    planName: '计划A',
    actionType: 'pause',
    result: { ok: true },
  }) + '\n');
  const dup = checkDuplicateToday(
    { planName: '计划A', type: 'pause' },
    { auditFile, init: () => {}, today: '2026-08-02' },
  );
  assert.strictEqual(dup.length, 1);
  assert.strictEqual(checkDuplicateToday({ planName: '计划B', type: 'pause' }, { auditFile, init: () => {}, today: '2026-08-02' }), null);

  assert.deepStrictEqual(loadQueue({ queueFile }), { actions: [] });
  const len = await enqueue(
    { type: 'pause', planName: '计划A', source: 'feishu', by: 'u1' },
    { queueFile, now: () => '2026-08-02T01:00:00Z' },
  );
  assert.strictEqual(len, 1);
  const q = loadQueue({ queueFile });
  assert.strictEqual(q.actions[0].planName, '计划A');
  saveQueue({ actions: [] }, { queueFile });
  assert.deepStrictEqual(loadQueue({ queueFile }), { actions: [] });

  assert.deepStrictEqual(loadPending({ pendingFile }), { pending: [] });
  const item = addPending(
    { planName: '计划A', type: 'pause', amount: 100 },
    'chat',
    {},
    { pendingFile, init: () => {}, randomUUID: () => 'uuid-1' },
  );
  assert.strictEqual(item.tempId, 'uuid-1');
  assert.strictEqual(item.chatId, 'chat');
  const found = findPending('chat', '计划A', { pendingFile, init: () => {} });
  assert.strictEqual(found.item.tempId, 'uuid-1');
  removePending(found.data, found.idx, { pendingFile });
  assert.deepStrictEqual(loadPending({ pendingFile }), { pending: [] });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
