// tests/feishu-listener-ai.test.mjs - listener AI 上下文与对话测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAccountContext, getCampaignList, callAI, handleAtMention } from '../src/services/feishu-listener-ai.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'listener-ai-'));
try {
  fs.writeFileSync(path.join(dir, '5m-2026-08-02T01-40-00.json'), JSON.stringify({
    accountSpend: 100,
    accountBudget: 1000,
    totalConv: 2,
    activeCount: 3,
    spendingCount: 4,
    accountBalance: 500,
    time: '2026-08-02T01:40:00Z',
  }));
  const ctx = await getAccountContext({ dataDir: dir });
  assert.strictEqual(ctx.totalSpend, 100);
  assert.strictEqual(ctx.spendingCount, 4);

  const list = await getCampaignList({
    createClient: async () => ({
      request: async () => ({
        data: { data: { projects: [{ project_name: '计划A', project_status_name: '启用', campaign_budget: 500 }] } },
      }),
    }),
  });
  assert.strictEqual(list[0].name, '计划A');

  const reply = await callAI('今天怎么样', {
    getAccountContextFn: async () => ctx,
    getCampaignListFn: async () => list,
    spawnSyncFn: () => {
      const tmpDir = path.join(os.tmpdir(), 'oec-ai');
      fs.writeFileSync(path.join(tmpDir, 'output.txt'), '一切正常');
      return { status: 0, pid: 1 };
    },
  });
  assert.strictEqual(reply, '一切正常');

  let mentionSent = null;
  await handleAtMention('@小七 今天消耗多少', 'chat', {
    chatNames: { chat: 'monitor' },
    cleanAtTextFn: text => text.replace('@小七 ', ''),
    callAIFn: async msg => `回答: ${msg}`,
    sendMsgFn: async (chatId, text) => {
      mentionSent = { chatId, text };
    },
  });
  assert.strictEqual(mentionSent.text, '回答: 今天消耗多少');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
