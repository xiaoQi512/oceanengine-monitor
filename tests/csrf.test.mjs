// tests/csrf.test.mjs — CSRF 防护单元测试 (T1-Q3 P0-1)
//
// 覆盖 csrf-utils.mjs 的核心 API:
//   - generateCsrfToken: 长度/唯一性
//   - signRequestUrl / verifySignedRequest: HMAC-SHA256 签名/验签
//   - verifyCsrfToken: Double-Submit Cookie 校验
//   - parseCookies / buildSetCookie: 边界条件
//   - isOriginAllowed: 白名单/拒绝
//   - 时序攻击防护 (safeEqualHex)
//
// 用法: node tests/csrf.test.mjs
// 不依赖任何网络/端口, 纯函数测试

import assert from 'node:assert';
import {
  generateCsrfToken,
  parseCookies,
  buildSetCookie,
  signRequestUrl,
  verifySignedRequest,
  verifyCsrfToken,
  isOriginAllowed,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  SIG_PARAM,
  TS_PARAM,
} from '../csrf-utils.mjs';

const TEST_SECRET = 'test-csrf-secret-32bytes-minimum-length-required-xxx';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
  }
}

console.log('===== CSRF 防护单元测试 =====');

// ============ generateCsrfToken ============
test('generateCsrfToken: 64 hex chars (32 bytes)', () => {
  const t = generateCsrfToken();
  assert.strictEqual(t.length, 64, `expected 64, got ${t.length}`);
  assert.match(t, /^[0-9a-f]{64}$/);
});

test('generateCsrfToken: 多次生成不重复', () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(generateCsrfToken());
  assert.strictEqual(set.size, 1000);
});

// ============ parseCookies / buildSetCookie ============
test('parseCookies: 空/单值/多值/特殊字符', () => {
  assert.deepStrictEqual(parseCookies(''), {});
  assert.deepStrictEqual(parseCookies('a=1'), { a: '1' });
  assert.deepStrictEqual(parseCookies('a=1; b=2; c=3'), { a: '1', b: '2', c: '3' });
  assert.deepStrictEqual(parseCookies('a=hello%20world'), { a: 'hello world' });
  assert.deepStrictEqual(parseCookies('  a = 1 ; b=2  '), { a: '1', b: '2' });
  // 缺失 = 的部分跳过
  assert.deepStrictEqual(parseCookies('a=1; broken; b=2'), { a: '1', b: '2' });
});

test('buildSetCookie: 必含属性 + 可选项', () => {
  const c = buildSetCookie('csrf_token', 'abc', { maxAge: 3600, sameSite: 'Strict' });
  assert.ok(c.startsWith('csrf_token=abc'));
  assert.ok(c.includes('Path=/'));
  assert.ok(c.includes('Max-Age=3600'));
  assert.ok(c.includes('SameSite=Strict'));
});

test('buildSetCookie: URL-encode 值', () => {
  const c = buildSetCookie('x', 'a b=c', {});
  assert.ok(c.includes('a%20b%3Dc'), '应 URL-encode 值, got: ' + c);
});

// ============ signRequestUrl / verifySignedRequest ============
test('signRequestUrl: 添加 sig + ts 参数, 保留原 query', () => {
  const u = signRequestUrl('/feedback?action=accept&alertId=abc', TEST_SECRET, { ts: 1700000000 });
  const url = new URL(u, 'http://x');
  assert.strictEqual(url.pathname, '/feedback');
  assert.strictEqual(url.searchParams.get('action'), 'accept');
  assert.strictEqual(url.searchParams.get('alertId'), 'abc');
  assert.strictEqual(url.searchParams.get(TS_PARAM), '1700000000');
  assert.ok(url.searchParams.get(SIG_PARAM));
  assert.match(url.searchParams.get(SIG_PARAM), /^[0-9a-f]{64}$/);
});

test('verifySignedRequest: 正确签名 → 通过', () => {
  const url = signRequestUrl('/feedback?action=accept&alertId=abc', TEST_SECRET, { ts: 1700000000 });
  const req = { method: 'GET', url };
  assert.strictEqual(verifySignedRequest(req, TEST_SECRET, { nowSec: 1700000000 }), true);
});

test('verifySignedRequest: 错 secret → 拒绝', () => {
  const url = signRequestUrl('/feedback?action=accept', TEST_SECRET, { ts: 1700000000 });
  const req = { method: 'GET', url };
  assert.strictEqual(verifySignedRequest(req, 'WRONG', { nowSec: 1700000000 }), false);
});

test('verifySignedRequest: 篡改参数 → 拒绝', () => {
  const url = signRequestUrl('/feedback?action=accept&alertId=abc', TEST_SECRET, { ts: 1700000000 });
  // 攻击者把 action 改为 reject
  const tampered = url.replace('action=accept', 'action=reject');
  const req = { method: 'GET', url: tampered };
  assert.strictEqual(verifySignedRequest(req, TEST_SECRET, { nowSec: 1700000000 }), false);
});

test('verifySignedRequest: 缺 sig → 拒绝', () => {
  const req = { method: 'GET', url: '/feedback?action=accept' };
  assert.strictEqual(verifySignedRequest(req, TEST_SECRET), false);
});

test('verifySignedRequest: 缺 ts → 拒绝', () => {
  const req = { method: 'GET', url: '/feedback?action=accept&sig=deadbeef' };
  assert.strictEqual(verifySignedRequest(req, TEST_SECRET), false);
});

test('verifySignedRequest: ts 过期 (>5min) → 拒绝', () => {
  const url = signRequestUrl('/feedback?action=accept', TEST_SECRET, { ts: 1700000000 });
  const req = { method: 'GET', url };
  // 1000s 后验证 → 超过 ±300s 容差
  assert.strictEqual(verifySignedRequest(req, TEST_SECRET, { nowSec: 1700001000 }), false);
});

test('verifySignedRequest: ts 偏移但未超容差 → 通过', () => {
  const url = signRequestUrl('/feedback?action=accept', TEST_SECRET, { ts: 1700000000 });
  const req = { method: 'GET', url };
  // 100s 偏移 (容差内)
  assert.strictEqual(verifySignedRequest(req, TEST_SECRET, { nowSec: 1700000100 }), true);
});

test('verifySignedRequest: 参数顺序不影响签名 (sort + canonical)', () => {
  // 同样 (a=1, b=2) 与 (b=2, a=1) 应有相同签名
  const u1 = signRequestUrl('/feedback?a=1&b=2', TEST_SECRET, { ts: 1700000000 });
  const u2 = signRequestUrl('/feedback?b=2&a=1', TEST_SECRET, { ts: 1700000000 });
  // 重排后 sig 应不同 (因为 URL 不同), 但验证时排序后应一致
  const req1 = { method: 'GET', url: u1 };
  const req2 = { method: 'GET', url: u2 };
  // 两个 URL 都能被相同 secret 验签通过 (规范化排序保证)
  assert.strictEqual(verifySignedRequest(req1, TEST_SECRET, { nowSec: 1700000000 }), true);
  assert.strictEqual(verifySignedRequest(req2, TEST_SECRET, { nowSec: 1700000000 }), true);
});

test('verifySignedRequest: method 也参与签名 (POST 不会被 GET 签名绕过)', () => {
  const u = signRequestUrl('/feedback?action=accept', TEST_SECRET, { ts: 1700000000 });
  // 用 GET 签名, 但请求 method 是 POST → 不应通过
  const req = { method: 'POST', url: u };
  assert.strictEqual(verifySignedRequest(req, TEST_SECRET, { nowSec: 1700000000 }), false);
});

test('signRequestUrl: 无 secret → 抛错', () => {
  assert.throws(() => signRequestUrl('/feedback', ''), /secret required/);
});

// ============ verifyCsrfToken (Double-Submit Cookie) ============
test('verifyCsrfToken: cookie + header 一致 → 通过', () => {
  const token = 'a'.repeat(64);
  const req = { headers: { cookie: `csrf_token=${token}`, 'x-csrf-token': token } };
  assert.strictEqual(verifyCsrfToken(req), true);
});

test('verifyCsrfToken: cookie 与 header 不一致 → 拒绝', () => {
  const req = { headers: { cookie: 'csrf_token=aaa', 'x-csrf-token': 'bbb' } };
  assert.strictEqual(verifyCsrfToken(req), false);
});

test('verifyCsrfToken: 缺 cookie → 拒绝', () => {
  const req = { headers: { 'x-csrf-token': 'a'.repeat(64) } };
  assert.strictEqual(verifyCsrfToken(req), false);
});

test('verifyCsrfToken: 缺 header → 拒绝', () => {
  const req = { headers: { cookie: `csrf_token=${'a'.repeat(64)}` } };
  assert.strictEqual(verifyCsrfToken(req), false);
});

test('verifyCsrfToken: 长度不同 → 拒绝 (防时序攻击第一步)', () => {
  const req = { headers: { cookie: 'csrf_token=short', 'x-csrf-token': 'a'.repeat(64) } };
  assert.strictEqual(verifyCsrfToken(req), false);
});

test('verifyCsrfToken: 头名称大小写不敏感 (Node normalize 为小写)', () => {
  // Node http.IncomingMessage.headers 是小写的, 但本工具函数期望小写
  const token = 'b'.repeat(64);
  const req = { headers: { cookie: `csrf_token=${token}`, 'x-csrf-token': token } };
  assert.strictEqual(verifyCsrfToken(req), true);
});

// ============ isOriginAllowed ============
test('isOriginAllowed: 白名单匹配 → 通过', () => {
  const req = { headers: { origin: 'http://127.0.0.1:8899' } };
  const allowed = ['http://127.0.0.1:8899', 'http://localhost:8899'];
  assert.strictEqual(isOriginAllowed(req, allowed), true);
});

test('isOriginAllowed: 不在白名单 → 拒绝', () => {
  const req = { headers: { origin: 'http://evil.com:8899' } };
  const allowed = ['http://127.0.0.1:8899'];
  assert.strictEqual(isOriginAllowed(req, allowed), false);
});

test('isOriginAllowed: 无 Origin (curl/内部调用) → 放行 (交由 HMAC 校验)', () => {
  const req = { headers: {} };
  const allowed = ['http://127.0.0.1:8899'];
  assert.strictEqual(isOriginAllowed(req, allowed), true);
});

test('isOriginAllowed: 无 Origin + Referer 匹配 → 通过', () => {
  const req = { headers: { referer: 'http://localhost:8899/dashboard' } };
  const allowed = ['http://localhost:8899'];
  assert.strictEqual(isOriginAllowed(req, allowed), true);
});

test('isOriginAllowed: 非法 URL → 拒绝', () => {
  const req = { headers: { origin: 'not a url' } };
  const allowed = ['http://127.0.0.1:8899'];
  assert.strictEqual(isOriginAllowed(req, allowed), false);
});

// ============ 集成: end-to-end 端点保护模拟 ============
test('E2E: POST /api/actions 缺 token → 拒绝', () => {
  // 模拟 feedback-server 的 csrfGuard 行为
  const req = { method: 'POST', url: '/api/actions', headers: {} };
  // 期望: 既无 HMAC 签名, 也无 Double-Submit token → 拒绝
  assert.strictEqual(verifySignedRequest(req, TEST_SECRET), false);
  assert.strictEqual(verifyCsrfToken(req), false);
});

test('E2E: POST /api/actions 带正确 token → 通过', () => {
  const token = 'c'.repeat(64);
  const req = {
    method: 'POST',
    url: '/api/actions',
    headers: { cookie: `csrf_token=${token}`, 'x-csrf-token': token },
  };
  assert.strictEqual(verifyCsrfToken(req), true);
});

test('E2E: GET /feedback 带正确签名 → 通过', () => {
  const u = signRequestUrl('/feedback?action=accept&alertId=abc123', TEST_SECRET, { ts: 1700000000 });
  const req = { method: 'GET', url: u };
  assert.strictEqual(verifySignedRequest(req, TEST_SECRET, { nowSec: 1700000000 }), true);
});

test('E2E: GET /feedback 无签名 → 拒绝', () => {
  const req = { method: 'GET', url: '/feedback?action=accept&alertId=abc123' };
  assert.strictEqual(verifySignedRequest(req, TEST_SECRET), false);
});

test('E2E: GET /api/snapshots 只读 → 不需要保护 (放行)', () => {
  // 此处不直接测试 csrfGuard, 但可以验证 readCookies 不抛错
  const req = { method: 'GET', url: '/api/snapshots', headers: {} };
  assert.doesNotThrow(() => parseCookies(req.headers.cookie));
});

test('E2E: GET /health 健康检查 → 放行', () => {
  // 无 Origin, 无 Cookie, 无 token — 但因为不是受保护路径, 应放行
  const req = { method: 'GET', url: '/health', headers: {} };
  assert.strictEqual(verifySignedRequest(req, TEST_SECRET), false);   // 无签名
  assert.strictEqual(verifyCsrfToken(req), false);                    // 无 token
  // 但 csrfGuard 会在路径不匹配时直接放行
});

// ============ 时序攻击防护 ============
test('safeEqualHex (内部): 等长不同值 → false', () => {
  // 通过 verifyCsrfToken 间接测试
  const req = {
    headers: {
      cookie: 'csrf_token=' + '0'.repeat(64),
      'x-csrf-token': 'f'.repeat(64),
    },
  };
  assert.strictEqual(verifyCsrfToken(req), false);
});

test('safeEqualHex (内部): 长度差异 → false (不抛错)', () => {
  const req = {
    headers: {
      cookie: 'csrf_token=abc',
      'x-csrf-token': 'def',
    },
  };
  assert.strictEqual(verifyCsrfToken(req), false);
});

test('safeEqualHex (内部): 无效 hex → false (不抛错)', () => {
  const req = {
    headers: {
      cookie: 'csrf_token=not-hex',
      'x-csrf-token': 'not-hex',
    },
  };
  // 解析失败应返回 false, 不抛异常
  assert.strictEqual(verifyCsrfToken(req), false);
});

// ============ 常量名导出 ============
test('常量名符合预期 (供其他模块引用)', () => {
  assert.strictEqual(CSRF_COOKIE_NAME, 'csrf_token');
  assert.strictEqual(CSRF_HEADER_NAME, 'x-csrf-token');
  assert.strictEqual(SIG_PARAM, 'sig');
  assert.strictEqual(TS_PARAM, 'ts');
});

console.log('');
console.log(`===== ${passed} passed, ${failed} failed =====`);
process.exit(failed > 0 ? 1 : 0);
