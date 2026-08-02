// tests/feishu-message-format.test.mjs - 飞书消息文本测试
import assert from 'node:assert';
import { buildReportResultMessage } from '../src/domain/feishu-message-format.mjs';

assert.ok(buildReportResultMessage({ ok: true, action: 'pause', planName: 'A' }).includes('暂停「A」'));
assert.ok(buildReportResultMessage({ ok: false, action: 'pause', planName: 'A', errMsg: 'boom' }).includes('boom'));

console.log('\n全部测试通过');
