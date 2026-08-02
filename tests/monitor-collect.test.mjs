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

assert.strictEqual(
  (await checkLiveStatus({
    ...deps,
    getOnlineRoomList: async () => [{ room_id: 'r1' }],
    getLiveRoomStatus: async () => ({ is_live: false }),
  })).isLive,
  false,
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
