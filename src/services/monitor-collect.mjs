// src/services/monitor-collect.mjs - 15min 监控直播状态与数据采集编排
import {
  createClient as defaultCreateApiClient,
  collectAllData as defaultCollectAllData,
  getOnlineRoomList as defaultGetOnlineRoomList,
  getLiveRoomStatus as defaultGetLiveRoomStatus,
} from './api-client.mjs';

export async function checkLiveStatus({
  force = false,
  createApiClient = defaultCreateApiClient,
  getOnlineRoomList = defaultGetOnlineRoomList,
  getLiveRoomStatus = defaultGetLiveRoomStatus,
} = {}) {
  if (force) {
    console.log(`[${new Date().toLocaleTimeString()}] 🧪 OEC_FORCE=1 强制绕过直播状态检查`);
    return { isLive: true, roomTitle: '', forced: true };
  }

  try {
    const roomClient = await createApiClient({ useCache: true });
    const onlineRooms = await getOnlineRoomList(roomClient);
    if (onlineRooms.length > 0) {
      const roomStatus = await getLiveRoomStatus(roomClient, onlineRooms[0].room_id);
      const isLive = roomStatus?.is_live || false;
      const roomTitle = roomStatus?.room_title || '';
      if (!isLive) {
        console.log(`[${new Date().toLocaleTimeString()}] ⓪ 直播间未开播，静默退出`);
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] ✅ 直播间在线: ${roomTitle}`);
      }
      return { isLive, roomTitle };
    }

    console.log('  ℹ 直播列表为空，按排班窗口视为在线');
    console.log(`[${new Date().toLocaleTimeString()}] ✅ 直播间在线: `);
    return { isLive: true, roomTitle: '' };
  } catch (e) {
    console.log(`  ⚠ 直播状态查询失败: ${e.message?.slice(0, 80)}，继续执行`);
    return { isLive: true, roomTitle: '' };
  }
}

export async function collectMonitorData({
  createApiClient = defaultCreateApiClient,
  collectAllData = defaultCollectAllData,
} = {}) {
  let campaigns = [];
  let accountSpend = 0;
  let accountBudget = 0;
  let accountBalance = 0;
  let pageSummary = null;
  let collectionMethod = 'unknown';

  try {
    console.log('  📡 尝试 HTTP API 采集...');
    const apiClient = await createApiClient({ useCache: true });
    const apiData = await collectAllData(apiClient);

    if (apiData.campaigns && apiData.campaigns.length > 0) {
      campaigns = apiData.campaigns;
      accountSpend = apiData.accountSpend;
      accountBudget = apiData.accountBudget;
      accountBalance = apiData.accountBalance;
      pageSummary = apiData.pageSummary;
      collectionMethod = 'http_api';
      console.log(`  ✅ HTTP API 采集成功 (${apiData.elapsed}s)`);
    } else {
      console.log('  ⚠ HTTP API 返回空数据，5分钟速报将兜底');
    }
  } catch (apiErr) {
    console.log(`  ⚠ HTTP API 失败: ${apiErr.message?.slice(0, 80)} | 5分钟速报兜底`);
    if (apiErr.message?.includes('未找到巨量引擎标签页') || apiErr.message?.includes('AUTO_LOGIN_FAILED')) {
      console.log('  ℹ 纯 HTTP API 模式，跳过重试');
    }
  }

  console.log(`  📦 采集完成: ${campaigns.length} 条计划 | 消耗 ¥${accountSpend.toFixed(2)} | 方案: ${collectionMethod}`);
  return { campaigns, accountSpend, accountBudget, accountBalance, pageSummary, collectionMethod };
}
