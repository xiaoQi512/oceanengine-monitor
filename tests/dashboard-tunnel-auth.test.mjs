import assert from 'node:assert/strict';
import {
  buildAuthCookie,
  DASHBOARD_AUTH_COOKIE,
  hashPassword,
  isDashboardAuthorized,
  parseCookies,
} from '../src/services/dashboard-tunnel-auth.mjs';

const password = 'test-password-123';
const hash = hashPassword(password);

assert.equal(hashPassword(password), hash);
assert.notEqual(hashPassword('wrong'), hash);
assert.deepEqual(
  parseCookies(`${DASHBOARD_AUTH_COOKIE}=${hash}; other=1`),
  { [DASHBOARD_AUTH_COOKIE]: hash, other: '1' },
);
assert.equal(isDashboardAuthorized({ headers: { cookie: buildAuthCookie(password) } }, password), true);
assert.equal(isDashboardAuthorized({ headers: { cookie: `other=1` } }, password), false);
assert.equal(isDashboardAuthorized({}, password), false);
assert.equal(isDashboardAuthorized({}, ''), false);

console.log('全部测试通过');
