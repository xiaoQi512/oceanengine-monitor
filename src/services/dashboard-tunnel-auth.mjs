import crypto from 'node:crypto';

export const DASHBOARD_AUTH_COOKIE = 'dashboard_tunnel_pwd';
export const DASHBOARD_AUTH_MAX_AGE_SEC = 24 * 3600;

export function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key) out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function isDashboardAuthorized(req, password) {
  if (!password) return false;
  const actual = parseCookies(req?.headers?.cookie)[DASHBOARD_AUTH_COOKIE];
  return safeEqualHex(actual, hashPassword(password));
}

export function buildAuthCookie(password) {
  return `${DASHBOARD_AUTH_COOKIE}=${hashPassword(password)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DASHBOARD_AUTH_MAX_AGE_SEC}`;
}

function safeEqualHex(actual, expected) {
  try {
    const a = Buffer.from(String(actual), 'hex');
    const b = Buffer.from(String(expected), 'hex');
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
