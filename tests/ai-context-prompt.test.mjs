// tests/ai-context-prompt.test.mjs - AI 上下文与提示词测试
import assert from 'node:assert';
import {
  buildAccountContextFromSnapshot,
  buildAIAccountBlock,
  buildAICampaignBlock,
  buildAIPrompt,
  buildAIFallbackMessage,
} from '../src/domain/ai-context-prompt.mjs';

const ctx = buildAccountContextFromSnapshot({ accountSpend: 100, accountBudget: 200, totalConv: 3, spendingCount: 2, _elapsedHours: 2 });
assert.strictEqual(ctx.totalSpend, 100);
assert.strictEqual(ctx.pct, 50);
assert.strictEqual(buildAIAccountBlock(ctx), '消耗¥100/200(50%) 转化3次 投放中2条');
assert.strictEqual(buildAICampaignBlock([{ name: 'A', budget: 1, status: '启用' }]), ' 计划: A(¥1)');
const prompt = buildAIPrompt({ accountName: '测试', aiDailyBudget: 5000, dataBlock: 'x', campBlock: 'y', userMessage: '消耗多少' });
assert.ok(prompt.includes('根据以上信息回答: 消耗多少'));
assert.ok(buildAIFallbackMessage().includes('暂时无法处理'));

console.log('\n全部测试通过');
