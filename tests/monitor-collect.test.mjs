// tests/monitor-collect.test.mjs - 直播状态与数据采集编排测试
import assert from 'node:assert';
import { checkLiveStatus, collectMonitorData } from '../src/services/monitor-collect.mjs';

let apiCalls = [];
const client = { tag: 'client' };
const deps = {
  createApiClient: async () => {
    apiCalls.push('create');
    return client;
  },
  getOnlineRoomList: async () => {
    apiCalls.push('rooms');
    return [];
  },
  getLiveRoomStatus: async () => {
    apiCalls.push('status');
    return { is_live: true, room_title: '测试直播' };
  },
};

apiCalls = [];
assert.deepStrictEqual(await checkLiveStatus({ ...deps, force: true }), { isLive: true, roomTitle: '', forced: true });
assert.deepStrictEqual(apiCalls, []);

apiCalls = [];
assert.deepStrictEqual(
  await checkLiveStatus({
    ...deps,
    getOnlineRoomList: async () => {
      apiCalls.push('rooms');
      return [{ room_id: 'r1' }];
    },
    getLiveRoomStatus: async () => {
      apiCalls.push('status');
      return { is_live: true, room_title: '测试直播' };
    },
  }),
  { isLive: true, roomTitle: '测试直播' },
);
assert.deepStrictEqual(apiCalls, ['create', 'rooms', 'status']);

// 首次 is_live=false，二次确认仍 false → 判定未开播
assert.strictEqual(
  (await checkLiveStatus({
    ...deps,
    getOnlineRoomList: async () => [{ room_id: 'r1' }],
    getLiveRoomStatus: async () => ({ is_live: false }),
    recheckDelayMs: 0,
  })).isLive,
  false,
);

// 首次 is_live=false，二次确认在线 → 判定在线（修复静默漏推）
let statusCalls = 0;
assert.deepStrictEqual(
  await checkLiveStatus({
    ...deps,
    getOnlineRoomList: async () => [{ room_id: 'r1' }],
    getLiveRoomStatus: async () => {
      statusCalls += 1;
      return statusCalls === 1 ? { is_live: false } : { is_live: true, room_title: '恢复直播' };
    },
    recheckDelayMs: 0,
  }),
  { isLive: true, roomTitle: '恢复直播' },
);

// 二次确认房间列表为空 → 按排班窗口视为在线
let roomCallCount = 0;
assert.strictEqual(
  (await checkLiveStatus({
    ...deps,
    getOnlineRoomList: async () => {
      roomCallCount += 1;
      return roomCallCount === 1 ? [{ room_id: 'r1' }] : [];
    },
    getLiveRoomStatus: async () => ({ is_live: false }),
    recheckDelayMs: 0,
  })).isLive,
  true,
);

// 二次确认 API 异常 → 保守视为在线
let roomCallCount2 = 0;
assert.strictEqual(
  (await checkLiveStatus({
    ...deps,
    getOnlineRoomList: async () => {
      roomCallCount2 += 1;
      if (roomCallCount2 > 1) throw new Error('二次查询网络错误');
      return [{ room_id: 'r1' }];
    },
    getLiveRoomStatus: async () => ({ is_live: false }),
    recheckDelayMs: 0,
  })).isLive,
  true,
);

assert.strictEqual((await checkLiveStatus(deps)).isLive, true);
assert.strictEqual(
  (await checkLiveStatus({
    ...deps,
    getOnlineRoomList: async () => { throw new Error('网络错误'); },
  })).isLive,
  true,
);

const success = await collectMonitorData({
  createApiClient: async () => client,
  collectAllData: async (receivedClient) => {
    assert.strictEqual(receivedClient, client);
    return {
      campaigns: [{ id: 1 }],
      accountSpend: 10,
      accountBudget: 20,
      accountBalance: 30,
      pageSummary: { conversions: 1 },
      elapsed: '0.1s',
    };
  },
});
assert.strictEqual(success.campaigns.length, 1);
assert.strictEqual(success.accountSpend, 10);
assert.strictEqual(success.collectionMethod, 'http_api');

const empty = await collectMonitorData({
  createApiClient: async () => client,
  collectAllData: async () => ({ campaigns: [] }),
});
assert.strictEqual(empty.campaigns.length, 0);
assert.strictEqual(empty.collectionMethod, 'unknown');

const failed = await collectMonitorData({
  createApiClient: async () => { throw new Error('AUTO_LOGIN_FAILED'); },
  collectAllData: async () => { throw new Error('never'); },
});
assert.strictEqual(failed.campaigns.length, 0);
assert.strictEqual(failed.accountSpend, 0);

console.log('\n全部测试通过');
