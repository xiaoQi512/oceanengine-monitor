// tests/csrf-http.test.mjs — CSRF 防护 HTTP 端到端测试 (T1-Q3 P0-1)
//
// 启动 feedback-server (临时端口) → 真实 HTTP 请求 → 验证 CSRF 保护生效
// 注意: 不写入真实 action-queue.json, 全部走测试 fixture
//
// 用法: node tests/csrf-http.test.mjs

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TEST_PORT = 18899;     // 测试端口 (避开 8899 生产)
const TEST_SECRET = 'integration-test-csrf-secret-32bytes-xx';

console.log('===== CSRF HTTP 集成测试 =====');

// 启动 feedback-server 子进程
const env = {
  ...process.env,
  CSRF_SECRET: TEST_SECRET,
  FEEDBACK_PORT: String(TEST_PORT),
  OEC_SILENT: '1',     // 抑制子进程控制台输出
};

const serverPath = path.join(ROOT, 'feedback-server.mjs');
const child = spawn(process.execPath, [serverPath], { env, stdio: 'pipe' });
let childOut = '';
child.stdout.on('data', d => childOut += d);
child.stderr.on('data', d => childOut += d);

// 等待 server 启动
async function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

const ready = await waitForServer();
if (!ready) {
  console.error('Server failed to start. Output:');
  console.error(childOut);
  child.kill();
  process.exit(1);
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
  }
}

async function request(p, opts = {}) {
  return fetch(`http://127.0.0.1:${TEST_PORT}${p}`, opts);
}

// 直接用 crypto 计算 HMAC 签名 (避免依赖 csrf-utils 的导出)
import crypto from 'node:crypto';
function signRequestUrl(input, secret, opts = {}) {
  const u = new URL(input, 'http://x');
  const method = String(opts.method || 'GET').toUpperCase();
  const ts = opts.ts != null ? opts.ts : Math.floor(Date.now() / 1000);
  const params = {};
  for (const [k, v] of u.searchParams.entries()) params[k] = v;
  // 排序后拼接
  const keys = Object.keys(params).filter(k => k !== 'sig' && k !== 'ts').sort();
  const qstr = keys.map(k => `${k}=${params[k]}`).join('&');
  const payload = [method, u.pathname, qstr, String(ts)].join('\n');
  const sig = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  u.searchParams.set('ts', String(ts));
  u.searchParams.set('sig', sig);
  return u.pathname + u.search;
}

try {
  // ====== 测试用例 ======

  await test('GET /health 健康检查放行 (无 CSRF)', async () => {
    const r = await request('/health');
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(body.ok, true);
  });

  await test('GET /api/snapshots 只读放行 + 下发 csrf_token cookie', async () => {
    const r = await request('/api/snapshots');
    assert.strictEqual(r.status, 200);
    const cookie = r.headers.get('set-cookie') || '';
    assert.ok(cookie.includes('csrf_token='), `期望下发 csrf_token cookie, got: ${cookie}`);
  });

  await test('POST /api/actions 缺 token → 403', async () => {
    const r = await request('/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'pause', campaign_id: '123' }),
    });
    assert.strictEqual(r.status, 403, `期望 403, got ${r.status}`);
    const body = await r.json();
    assert.strictEqual(body.error, 'CSRF');
  });

  await test('POST /api/actions 带错误 token → 403', async () => {
    const r = await request('/api/actions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'wrong-token',
        Cookie: 'csrf_token=different-token',
      },
      body: JSON.stringify({ type: 'pause', campaign_id: '123' }),
    });
    assert.strictEqual(r.status, 403);
  });

  await test('POST /api/actions 带正确 token → 200/400 (CSRF 通过)', async () => {
    // 1. 先 GET 获取 cookie
    const getR = await request('/api/snapshots');
    const setCookie = getR.headers.get('set-cookie') || '';
    const m = setCookie.match(/csrf_token=([^;]+)/);
    assert.ok(m, '期望 GET 返回 csrf_token cookie');
    const token = m[1];

    // 2. POST 带 cookie + header
    const r = await request('/api/actions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
        Cookie: `csrf_token=${token}`,
      },
      body: JSON.stringify({ type: 'pause', campaign_id: '123456' }),
    });
    // 业务校验可能 200/400, CSRF 已通过
    assert.ok(r.status === 200 || r.status === 400,
              `期望 200/400 (CSRF 通过), got ${r.status}`);
  });

  await test('GET /feedback 无签名 → 403', async () => {
    const r = await request('/feedback?action=accept&alertId=test');
    assert.strictEqual(r.status, 403);
    const body = await r.json();
    assert.strictEqual(body.error, 'CSRF');
  });

  await test('GET /feedback 带错误签名 → 403', async () => {
    const r = await request('/feedback?action=accept&alertId=test&sig=deadbeef&ts=1700000000');
    assert.strictEqual(r.status, 403);
  });

  await test('GET /feedback 带正确 HMAC 签名 → 200/400 (CSRF 通过)', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const url = signRequestUrl('/feedback?action=accept&alertId=integration-test',
                                TEST_SECRET, { ts });
    const r = await request(url);
    // 200 (成功) 或 400 (业务校验) 都说明 CSRF 通过
    assert.ok(r.status === 200 || r.status === 400,
              `期望 200/400 (CSRF 通过), got ${r.status}`);
  });

  await test('GET /feedback 签名 ts 过期 → 403', async () => {
    // 1 小时前的签名 → 超过 300s 容差
    const ts = Math.floor(Date.now() / 1000) - 3600;
    const url = signRequestUrl('/feedback?action=accept&alertId=expired-test',
                                TEST_SECRET, { ts });
    const r = await request(url);
    assert.strictEqual(r.status, 403);
  });

  await test('GET /mark-ignored 无签名 → 403', async () => {
    const r = await request('/mark-ignored?ids=1,2,3');
    assert.strictEqual(r.status, 403);
  });

  await test('GET /api/snapshots 跨域请求仍能读 (只读 GET 不受 CSRF)', async () => {
    // 跨域 GET 不带 Origin → isOriginAllowed 返回 true, 放行
    const r = await request('/api/snapshots', {
      headers: { Origin: 'http://evil.com' },
    });
    // 因为是只读 GET, 不在保护列表, 直接放行
    assert.strictEqual(r.status, 200);
  });

  await test('POST /api/actions 跨域 + 缺 token → 403', async () => {
    // 跨域 POST 既无 HMAC 也无 token, 必然 403
    const r = await request('/api/actions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://evil.com',
      },
      body: JSON.stringify({ type: 'pause', campaign_id: 'evil' }),
    });
    assert.strictEqual(r.status, 403);
  });

  await test('csrf_token cookie 包含 SameSite=Strict', async () => {
    const r = await request('/api/snapshots');
    const setCookie = r.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('SameSite=Strict'),
              `期望 SameSite=Strict, got: ${setCookie}`);
  });

  await test('csrf_token cookie 包含 Path=/', async () => {
    const r = await request('/api/snapshots');
    const setCookie = r.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('Path=/'),
              `期望 Path=/, got: ${setCookie}`);
  });

  await test('csrf_token cookie 24h 有效期', async () => {
    const r = await request('/api/snapshots');
    const setCookie = r.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('Max-Age=86400'),
              `期望 Max-Age=86400 (24h), got: ${setCookie}`);
  });

  await test('PUT/DELETE 受 CSRF 保护 (方法级防护)', async () => {
    // 这些方法在我们的保护列表里, 应被拦截
    const r1 = await request('/api/actions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const r2 = await request('/api/actions', { method: 'DELETE' });
    assert.strictEqual(r1.status, 403);
    assert.strictEqual(r2.status, 403);
  });

} finally {
  child.kill();
  // 给子进程时间清理
  await new Promise(r => setTimeout(r, 500));
}

console.log('');
console.log(`===== ${passed} passed, ${failed} failed =====`);
process.exit(failed > 0 ? 1 : 0);
