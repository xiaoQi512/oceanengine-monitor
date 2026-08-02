// tests/daily-summary-core.test.mjs - 大号日汇报核心测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSessionsForDate, fetchLiveAllDay, fetchVideoAllDay, readAnchorNames, pushToLark, buildDailySummaryMessage } from '../src/services/daily-summary-core.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-summary-'));
const sessions = getSessionsForDate('2026-08-02', { dataDir: dir });
assert.strictEqual(sessions.length, 9);
fs.rmSync(dir, { recursive: true, force: true });

const live = await fetchLiveAllDay({
  createClientFn: async () => ({}),
  getSessionStatsFn: async () => ({ total: { cost: 10, leads: 2 } }),
  getSessionsForDateFn: () => [{ start: '09:00', end: '12:00' }],
  getTodayDateStrFn: () => '2026-08-02',
  logFn: () => {},
});
assert.strictEqual(live.totalConsume, 10);

const emptyLive = await fetchLiveAllDay({
  createClientFn: async () => ({}),
  getSessionStatsFn: async () => ({}),
  getSessionsForDateFn: () => [],
  getTodayDateStrFn: () => '2026-08-02',
  logFn: () => {},
});
assert.deepStrictEqual(emptyLive, { totalConsume: 0, totalLeads: 0, cpl: '0.00' });

const video = await fetchVideoAllDay({
  createClientFn: async () => ({ cookieData: { headers: {} } }),
  getLocalDateFn: () => '2026-08-02',
  httpsRequestFn: (options, cb) => {
    const res = {
      on(event, fn) {
        if (event === 'data') fn(JSON.stringify({
          data: { StatsData: { Rows: [
            { Dimensions: { cdp_marketing_goal: { ValueStr: '短视频' } }, Metrics: { stat_cost: { ValueStr: '20' }, convert_cnt: { ValueStr: '1' } } },
          ] } },
        }));
        if (event === 'end') fn();
      },
    };
    cb(res);
    return { on() {}, write() {}, end() {}, destroy() {} };
  },
  logFn: () => {},
});
assert.strictEqual(video.totalConsume, 20);

const anchors = readAnchorNames({
  findLarkCliFn: () => 'lark.exe',
  getLocalDateFn: () => '2026-08-02',
  fetchShiftRowsByDateFn: () => [
    { label: '09:00-12:00', hours: [9, 10, 11], row: 200, anchorName: '主播A' },
    { label: '12:00-15:00', hours: [12, 13, 14], row: 201, anchorName: '主播A' },
  ],
  logFn: () => {},
});
assert.deepStrictEqual(anchors, ['主播A']);

assert.strictEqual(pushToLark('x', {
  findLarkCliFn: () => 'lark.exe',
  execFileSyncFn: () => JSON.stringify({ ok: true, data: { message_id: 'm' } }),
  logFn: () => {},
}), true);

const msg = buildDailySummaryMessage({
  live: { totalConsume: 10, totalLeads: 2 },
  video: { totalConsume: 20, totalLeads: 1 },
  anchors: ['主播A'],
  sessions: [{ start: '09:00', end: '12:00' }],
  todayLabel: '8月2日',
});
assert.ok(msg.includes('8月2日数据汇总'));
assert.ok(msg.includes('主播A'));

console.log('\n全部测试通过');
