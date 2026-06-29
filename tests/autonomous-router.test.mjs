// tests/autonomous-router.test.mjs — 路由器多场景测试

import assert from 'node:assert';
import { Provider, AutonomousRouter, CircuitBreaker } from '../autonomous-router.mjs';

async function testCircuitBreakerOpensAfterFailures() {
  let calls = 0;
  const failing = new Provider('fail', async () => { calls++; throw new Error('boom'); }, { timeoutMs: 1000 });
  const router = new AutonomousRouter([failing], { maxRetries: 0 });

  for (let i = 0; i < 5; i++) {
    try { await router.route({}); } catch {}
  }
  assert.strictEqual(failing.circuit.state, 'OPEN', '熔断器应在连续失败后打开');
  assert.strictEqual(calls, 5, '应已调用 5 次');
  console.log('✅ testCircuitBreakerOpensAfterFailures');
}

async function testRouterFallsBackToSecondProvider() {
  const primary = new Provider('primary', async () => { throw new Error('primary down'); }, { timeoutMs: 1000 });
  let fallbackCalls = 0;
  const fallback = new Provider('fallback', async () => { fallbackCalls++; return { ok: true }; }, { timeoutMs: 1000 });
  const router = new AutonomousRouter([primary, fallback], { maxRetries: 0 });

  const result = await router.route({});
  assert.strictEqual(result.provider, 'fallback');
  assert.strictEqual(fallbackCalls, 1);
  console.log('✅ testRouterFallsBackToSecondProvider');
}

async function testCostGuardrailSkipsExpensiveProvider() {
  const cheap = new Provider('cheap', async () => { return { ok: true }; }, { costPerRun: 0.001, timeoutMs: 1000 });
  const expensive = new Provider('expensive', async () => { return { ok: true }; }, { costPerRun: 0.1, timeoutMs: 1000 });
  const router = new AutonomousRouter([expensive, cheap], { maxCostPerRun: 0.01, maxRetries: 0 });

  const result = await router.route({});
  assert.strictEqual(result.provider, 'cheap');
  console.log('✅ testCostGuardrailSkipsExpensiveProvider');
}

async function testTimeoutTriggersCircuit() {
  const slow = new Provider('slow', async () => { await new Promise(r => setTimeout(r, 2000)); return {}; }, { timeoutMs: 100 });
  const router = new AutonomousRouter([slow], { maxRetries: 0 });
  try {
    await router.route({});
    assert.fail('应超时');
  } catch (e) {
    assert.ok(e.message.includes('TIMEOUT') || e.message.includes('All providers failed'));
  }
  console.log('✅ testTimeoutTriggersCircuit');
}

async function run() {
  await testCircuitBreakerOpensAfterFailures();
  await testRouterFallsBackToSecondProvider();
  await testCostGuardrailSkipsExpensiveProvider();
  await testTimeoutTriggersCircuit();
  console.log('\n全部测试通过');
}

run().catch(e => { console.error(e); process.exit(1); });
