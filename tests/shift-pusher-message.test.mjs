// tests/shift-pusher-message.test.mjs - 换班推送消息构建测试
import assert from 'node:assert';
import { buildShiftPushMessage } from '../src/services/shift-pusher-message.mjs';

const msg = buildShiftPushMessage({
  todayLabel: '8月2日',
  shiftLabel: '09:00-12:00',
  anchorName: '主播A',
  totalConsume: 100,
  totalLeads: 5,
  cpl: '20.00',
  carModel: '贝塔S3',
});
assert.ok(msg.includes('主播A'));
assert.ok(msg.includes('贝塔S3'));

console.log('\n全部测试通过');
