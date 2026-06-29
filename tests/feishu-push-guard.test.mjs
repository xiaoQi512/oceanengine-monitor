// tests/feishu-push-guard.test.mjs
import { createLarkProvider, guardedFeishuPush } from '../feishu-push-guard.mjs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function testMissingCli() {
  try {
    await guardedFeishuPush({ larkCmd: '', msgType: 'text', content: '{}' });
    throw new Error('应抛出 LARK_CLI_MISSING');
  } catch (e) {
    assert(e.message === 'LARK_CLI_MISSING', `异常信息错误: ${e.message}`);
  }
  console.log('✅ testMissingCli');
}

async function testCircuitBreaker() {
  let calls = 0;
  const p = createLarkProvider('/dummy/lark-cli.exe', {
    timeoutMs: 500,
    circuitFailureThreshold: 2,
    circuitFailureWindow: 3,
    circuitOpenDurationMs: 100,
  });
  // 替换原始 executor 为快速失败
  p.executor = async () => { calls++; throw new Error('boom'); };

  for (let i = 0; i < 5; i++) {
    try { await p.execute({}); } catch {}
  }
  assert(p.circuit.isOpen, '熔断器应已打开');
  assert(calls < 5, `不应无限重试，实际调用 ${calls} 次`);
  console.log('✅ testCircuitBreaker');
}

async function testSuccessPath() {
  const p = createLarkProvider('/dummy/lark-cli.exe');
  p.executor = async () => ({ data: { message_id: 'abc' } });
  const r = await p.execute({ args: [] });
  assert(r.success && r.result.data.message_id === 'abc', '成功路径应返回结果');
  console.log('✅ testSuccessPath');
}

async function testInvalidJsonDetection() {
  const p = createLarkProvider('/dummy/lark-cli.exe');
  p.executor = async () => {
    throw new Error('LARK_INVALID_JSON: content is not valid JSON');
  };
  try {
    await p.execute({ args: [] });
    throw new Error('应识别 JSON 错误');
  } catch (e) {
    assert(e.message.includes('LARK_INVALID_JSON'), `错误类型错误: ${e.message}`);
  }
  console.log('✅ testInvalidJsonDetection');
}

(async () => {
  await testMissingCli();
  await testCircuitBreaker();
  await testSuccessPath();
  await testInvalidJsonDetection();
  console.log('\n全部通过');
})();
