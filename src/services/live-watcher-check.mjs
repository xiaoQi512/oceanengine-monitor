// src/services/live-watcher-check.mjs - live-watcher 直播状态查询
import { createClient, getOnlineRoomList, getLiveRoomStatus } from './api-client.mjs';
import { timeStr } from './live-watcher-state.mjs';

export async function checkLiveStatus({
  createClientFn = createClient,
  getOnlineRoomListFn = getOnlineRoomList,
  getLiveRoomStatusFn = getLiveRoomStatus,
} = {}) {
  try {
    const client = await createClientFn({ useCache: true });
    const onlineRooms = await getOnlineRoomListFn(client);
    if (onlineRooms.length === 0) return { isLive: false, roomTitle: '' };
    const room = await getLiveRoomStatusFn(client, onlineRooms[0].room_id);
    return { isLive: room?.is_live || false, roomTitle: room?.room_title || '' };
  } catch (e) {
    console.error(`[${timeStr()}] ⚠ API查询失败: ${e.message?.slice(0, 80)}`);
    return null;
  }
}
