// tests/ai-diagnosis.test.mjs - AI 诊断建议引擎测试
import assert from 'node:assert';
import {
  buildDiagnosisSuggestions,
  summarizeDiagnosis,
} from '../src/domain/ai-diagnosis.mjs';

const baseAnalysis = {
  delta: {
    speedCurrent: 42.5,
    budgetUsed: 0.63,
    projectedDaily: 28000,
  },
  summary: {
    totalSpend: 18900,
    avgCPA: 95,
  },
};

function makeAlert(type, overrides = {}) {
  return {
    type,
    severity: 'medium',
    detail: `测试告警: ${type}`,
    name: `测试告警-${type}`,
    ...overrides,
  };
}

async function testBasicDiagnosis() {
  const alerts = [
    makeAlert('zero_conv', { campaignId: 'c1', planName: '0719-短引直-S3（真人口播）' }),
    makeAlert('high_cpa', { campaignId: 'c2', planName: '0802-画面直投' }),
    makeAlert('budget_cap', { campaignId: 'c3', planName: '0729-简单投-画面直投' }),
    makeAlert('unknown_type'), // 应被忽略
  ];
  const suggestions = buildDiagnosisSuggestions({ alerts, analysis: baseAnalysis, history: null, rules: [] });
  assert.strictEqual(suggestions.length, 3, `应生成3条建议，实际 ${suggestions.length}`);
  assert.ok(suggestions.every(s => s.suggestion && s.expectedImpact && s.risk && s.stopLoss), '每条建议应包含完整决策信息');
  assert.ok(suggestions.every(s => Array.isArray(s.evidence) && s.evidence.length > 0), '每条建议应包含依据');
  console.log('✅ 基础诊断建议生成');
}

async function testSuppressByHistory() {
  const history = {
    summary: {
      byType: { zero_conv: { rejected: 2, accepted: 0 } },
    },
    suggestions: [],
  };
  const alerts = [makeAlert('zero_conv', { campaignId: 'c1', planName: '测试计划' })];
  const suggestions = buildDiagnosisSuggestions({ alerts, analysis: baseAnalysis, history, rules: [] });
  assert.strictEqual(suggestions.length, 0, '已被拒绝2次的类型应被抑制');
  console.log('✅ 历史拒绝抑制');
}

async function testRelatedRule() {
  const rules = [
    { id: 'R-1', action: 'pause', deliveryType: '短引直', successRate: 0.75, confidence: 0.8, evidence: 4 },
  ];
  const alerts = [
    makeAlert('zero_conv', { campaignId: 'c1', planName: '0719-短引直-S3（真人口播）' }),
  ];
  const suggestions = buildDiagnosisSuggestions({ alerts, analysis: baseAnalysis, history: null, rules });
  assert.strictEqual(suggestions.length, 1);
  assert.ok(suggestions[0].relatedRule, '应关联到历史操作规则');
  assert.strictEqual(suggestions[0].relatedRule.id, 'R-1');
  console.log('✅ 历史效果规则关联');
}

async function testSummary() {
  const alerts = [
    makeAlert('zero_conv', { campaignId: 'c1', severity: 'high' }),
    makeAlert('high_cpa', { campaignId: 'c2', severity: 'medium' }),
  ];
  const suggestions = buildDiagnosisSuggestions({ alerts, analysis: baseAnalysis, history: null, rules: [] });
  const summary = summarizeDiagnosis(suggestions);
  assert.strictEqual(summary.total, 2);
  assert.strictEqual(summary.highCount, 1);
  assert.strictEqual(summary.mediumCount, 1);
  assert.deepStrictEqual(summary.byType, { zero_conv: 1, high_cpa: 1 });
  console.log('✅ 诊断汇总');
}

async function run() {
  await testBasicDiagnosis();
  await testSuppressByHistory();
  await testRelatedRule();
  await testSummary();
  console.log('\n全部测试通过');
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
