// tests/metrics-registry.test.mjs - 指标注册表校验与查询测试
import assert from 'node:assert';
import {
  loadMetricsRegistry,
  validateMetricsRegistry,
  getMetric,
  getMetricsByScope,
  listMetrics,
} from '../src/domain/metrics-registry.mjs';

const registry = loadMetricsRegistry();

async function testValidate() {
  const result = validateMetricsRegistry(registry);
  assert.strictEqual(result.ok, true, `指标注册表校验失败: ${result.errors.join('; ')}`);
  console.log('✅ 指标注册表结构校验通过');
}

async function testGetMetric() {
  const spend = getMetric(registry, 'totalSpend');
  assert.ok(spend, '应能通过别名 totalSpend 找到 spend_total');
  assert.strictEqual(spend.id, 'spend_total');

  const cpl = getMetric(registry, 'cpl_total');
  assert.ok(cpl, '应能找到 cpl_total');
  assert.strictEqual(cpl.unit, 'CNY');
  console.log('✅ 指标别名查询通过');
}

async function testScopeFilter() {
  const liveMetrics = getMetricsByScope(registry, { businessScope: 'live' });
  assert.ok(liveMetrics.length >= 2, `直播业务应至少2个指标，实际 ${liveMetrics.length}`);
  assert.ok(liveMetrics.every(m => m.businessScope === 'live' || m.businessScope === 'all'));
  console.log('✅ 指标业务范围过滤通过');
}

async function testListMetrics() {
  const list = listMetrics(registry);
  assert.strictEqual(list.length, registry.metrics.length);
  assert.ok(list.every(m => m.id && m.name && m.unit));
  console.log('✅ 指标列表输出通过');
}

async function run() {
  await testValidate();
  await testGetMetric();
  await testScopeFilter();
  await testListMetrics();
  console.log('\n全部测试通过');
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
