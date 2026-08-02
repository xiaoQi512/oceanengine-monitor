// tests/monitor-chrome.test.mjs - 监控 Chrome 拉起测试
import assert from 'node:assert';
import { checkChrome, launchChrome } from '../src/cdp/monitor-chrome.mjs';

assert.strictEqual(typeof checkChrome, 'function');
const result = await launchChrome({
  findChromeExe: () => '',
  chromeUserDataDir: 'D:\\ChromeCDP\\User Data',
  chromeProfileDirectory: 'Profile 4',
  campaignUrl: 'https://ad.oceanengine.com',
});
assert.strictEqual(result, false);

console.log('\n全部测试通过');
