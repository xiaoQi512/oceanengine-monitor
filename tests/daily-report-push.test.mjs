// tests/daily-report-push.test.mjs - 日报卡片推送测试
import assert from 'node:assert';
import { pushDailyReportCard } from '../src/services/daily-report-push.mjs';

const logs = [];
const ok = await pushDailyReportCard({
  larkCli: 'lark',
  chatId: 'chat',
  cardContent: JSON.stringify({ header: { title: { content: 'test' } } }),
  pushCardFn: async () => ({ ok: true, result: { data: { message_id: 'm1' } } }),
  logFn: msg => logs.push(msg),
});
assert.strictEqual(ok, true);
assert.ok(logs.some(l => l.includes('已推送')));

let threw = null;
try {
  await pushDailyReportCard({
    larkCli: 'lark',
    chatId: 'chat',
    cardContent: JSON.stringify({}),
    pushCardFn: async () => ({ ok: false, error: 'boom' }),
    logFn: () => {},
  });
} catch (e) {
  threw = e.message;
}
assert.strictEqual(threw, '推送失败: boom');

console.log('\n全部测试通过');
