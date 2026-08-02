// csrf-utils.mjs — CSRF 防护工具 (T1-Q3 P0-1)
//
// 提供两类保护机制:
//  1. Double-Submit Cookie — 浏览器 dashboard 调用 POST /api/actions 时使用
//     - 服务端下发 csrf_token cookie (非 HttpOnly, SameSite=Strict)
//     - 前端读 cookie 写入 X-CSRF-Token 请求头
//     - 服务端验证 cookie 与 header 一致
//     原理: 攻击者无法读取受害者浏览器中的 cookie (同源策略), 也无法伪造 X-CSRF-Token
//
//  2. HMAC-SHA256 签名 — 飞书卡片 / 监控脚本等非浏览器渠道调用 /feedback、/mark-ignored 时使用
//     - URL 携带 sig + ts 两个参数
//     - 服务端验证 HMAC(secret, METHOD || PATH || SORTED_QUERY || ts) === sig
//     - ts 必须在 ±300s 窗口内 (防重放)
//     原理: 攻击者不知道 secret, 无法伪造签名
//
// 用法示例:
//   // 签名 URL (监控脚本构造飞书卡片按钮链接)
//   import { signRequestUrl } from './csrf-utils.mjs';
//   const url = signRequestUrl('/feedback?action=accept&alertId=abc', secret);
//
//   // 验证请求 (feedback-server.mjs 中)
//   import { verifySignedRequest } from './csrf-utils.mjs';
//   if (!verifySignedRequest(req, secret)) return forbidden();
//
// 安全要点:
//   - secret 必须从环境变量读取, 至少 32 字节随机
//   - 不在 URL 中传输 secret
//   - 时间戳容差不宜过大 (默认 300s), 避免重放窗口过大
//   - HMAC 字符串拼接格式固定, 防止参数顺序差异绕过
//   - 常量时间比较 (crypto.timingSafeEqual), 防止时序攻击

import crypto from 'node:crypto';

// ====== 常量 ======
export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';
export const SIG_PARAM = 'sig';
export const TS_PARAM = 'ts';
export const DEFAULT_TS_TOLERANCE_SEC = 300;     // ±5 min
export const CSRF_COOKIE_MAX_AGE_SEC = 24 * 3600;

// ====== Token 生成 ======

/**
 * 生成 32 字节 (64 hex 字符) 的 CSRF token
 * @returns {string} 十六进制字符串
 */
export function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 生成 HMAC 签名 (内部辅助)
 * @param {string} secret
 * @param {string} payload
 * @returns {string} hex 编码 HMAC-SHA256
 */
function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

// ====== Cookie 解析 ======

/**
 * 解析 Cookie 头, 返回键值对象
 * @param {string|undefined} header
 * @returns {Object}
 */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    if (k) out[k] = v;
  }
  return out;
}

/**
 * 构造 Set-Cookie 头
 * @param {string} name
 * @param {string} value
 * @param {Object} [opts]
 * @returns {string}
 */
export function buildSetCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push('Secure');
  if (opts.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

// ====== HMAC URL 签名 (用于 /feedback、/mark-ignored) ======

/**
 * 构造签名 payload 字符串 (固定格式, 防参数顺序绕过)
 * @param {string} method    HTTP method (大写)
 * @param {string} path      URL path
 * @param {Object} [query]   解析后的 query 键值 (sig/ts 会被剔除)
 * @param {string|number} [ts]
 * @returns {string}
 */
function buildPayload(method, path, query = {}, ts = '') {
  const keys = Object.keys(query)
    .filter(k => k !== SIG_PARAM && k !== TS_PARAM)
    .sort();
  const qstr = keys.map(k => `${k}=${String(query[k] ?? '')}`).join('&');
  return [String(method).toUpperCase(), path, qstr, String(ts)].join('\n');
}

/**
 * 给 URL 或 path+query 附加 sig + ts
 * @param {string} input  完整 URL 或 "path?query"
 * @param {string} secret
 * @param {Object} [opts] { method?: string, ts?: number }
 * @returns {string} 带签名的 URL
 */
export function signRequestUrl(input, secret, opts = {}) {
  if (!secret) throw new Error('signRequestUrl: secret required');
  const u = new URL(input, 'http://placeholder.local');
  const method = String(opts.method || 'GET').toUpperCase();
  const ts = opts.ts != null ? opts.ts : Math.floor(Date.now() / 1000);
  const params = {};
  for (const [k, v] of u.searchParams.entries()) params[k] = v;
  const payload = buildPayload(method, u.pathname, params, ts);
  const sig = hmacHex(secret, payload);
  // 写入 sig 和 ts
  u.searchParams.set(TS_PARAM, String(ts));
  u.searchParams.set(SIG_PARAM, sig);
  return u.pathname + u.search;
}

/**
 * 验证请求的 HMAC 签名
 * @param {{ method: string, url: string, headers?: Object }} req
 * @param {string} secret
 * @param {Object} [opts] { toleranceSec?: number, nowSec?: number }
 * @returns {boolean}
 */
export function verifySignedRequest(req, secret, opts = {}) {
  if (!secret) return false;
  if (!req || !req.url) return false;
  const tolerance = opts.toleranceSec != null ? opts.toleranceSec : DEFAULT_TS_TOLERANCE_SEC;
  const now = opts.nowSec != null ? opts.nowSec : Math.floor(Date.now() / 1000);

  let u;
  try { u = new URL(req.url, 'http://placeholder.local'); } catch { return false; }
  const sig = u.searchParams.get(SIG_PARAM);
  const tsStr = u.searchParams.get(TS_PARAM);
  if (!sig || !tsStr) return false;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now - ts) > tolerance) return false;   // 防重放

  const params = {};
  for (const [k, v] of u.searchParams.entries()) params[k] = v;
  const payload = buildPayload(req.method || 'GET', u.pathname, params, ts);
  const expected = hmacHex(secret, payload);
  return safeEqualHex(sig, expected);
}

// ====== Double-Submit Cookie 验证 ======

/**
 * 验证浏览器 POST 请求的 CSRF token (cookie + header 一致)
 * @param {{ headers: Object }} req
 * @returns {boolean}
 */
export function verifyCsrfToken(req) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = (req.headers && req.headers[CSRF_HEADER_NAME]) || '';
  if (!cookieToken || !headerToken) return false;
  if (cookieToken.length !== headerToken.length) return false;
  return safeEqualHex(cookieToken, headerToken);
}

/**
 * 常量时间比较两个等长 hex 字符串
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqualHex(a, b) {
  try {
    const ab = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    if (ab.length === 0 || ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

// ====== Origin / Referer 校验 (辅助层) ======

/**
 * 检查请求的 Origin 或 Referer 是否在白名单内
 * @param {{ headers: Object }} req
 * @param {string[]} allowed  e.g. ['http://127.0.0.1:8899', 'http://192.168.1.10:8899']
 * @returns {boolean} true 表示通过 (无 Origin/Referer 头, 或匹配白名单)
 */
export function isOriginAllowed(req, allowed) {
  if (!req || !req.headers) return true;       // 无头信息视作非浏览器, 放行给 HMAC 校验
  const origin = (req.headers.origin || req.headers.referer || '').toString();
  if (!origin) return true;                     // 同源 GET / 内部调用可能无 Origin
  try {
    const u = new URL(origin);
    const base = `${u.protocol}//${u.host}`;
    return allowed.includes(base);
  } catch {
    return false;
  }
}
