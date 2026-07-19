// live-watcher.mjs — 直播间状态监听
// 每60s轮询巨量引擎API检查直播间开播状态，跟踪变迁：
//   offline→online: 记录开播时间
//   online→offline: 等待5min → 二次确认 → 日汇总由 PM2 cron 统一调度
// 状态持久化到 monitor-data/live-state.json，API失败不误判
//
// PM2: ecosystem.config.cjs 中作为常驻进程

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient, getOnlineRoomList, getLiveRoomStatus } from "./oceanengine-api-client.mjs";
import { DATA_DIR } from "./monitor-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(DATA_DIR, "live-state.json");
const POLL_INTERVAL_MS = 60_000;  // 60s 轮询
const OFFLINE_CONFIRM_DELAY_MS = 5 * 60_000;  // 下播后等5分钟再确认
const OFFLINE_RECHECK_DELAY_MS = 30_000;       // 二次确认间隔

// ====== 状态管理 ======
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch {}
  return { wasLive: false, lastChangeTime: null, todayDate: "" };
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function timeStr() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

// ====== 检查直播状态 ======
async function checkLiveStatus() {
  try {
    const client = await createClient({ useCache: true });
    const onlineRooms = await getOnlineRoomList(client);
    if (onlineRooms.length === 0) return { isLive: false, roomTitle: "" };
    const room = await getLiveRoomStatus(client, onlineRooms[0].room_id);
    return {
      isLive: room?.is_live || false,
      roomTitle: room?.room_title || "" };
  } catch (e) {
    console.error(`[${timeStr()}] ⚠ API查询失败: ${e.message?.slice(0, 80)}`);
    return null;  // null 表示查询失败，保持旧状态
  }
}

// ====== 主循环 ======
async function main() {
  console.log(`[${timeStr()}] 🟢 live-watcher 启动 (轮询间隔 ${POLL_INTERVAL_MS / 1000}s)`);

  let state = loadState();
  // 日期更替时重置标记
  const td = todayStr();
  if (state.todayDate !== td) {
    state.todayDate = td;
    saveState(state);
    console.log(`[${timeStr()}] 📅 新的一天: ${td}`);
  }
  console.log(`[${timeStr()}] 初始状态: wasLive=${state.wasLive}`);

  while (true) {
    try {
      const result = await checkLiveStatus();

      // API失败：保持旧状态，不触发任何动作
      if (result === null) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const { isLive, roomTitle } = result;
      const prevWasLive = state.wasLive;

      // --- 状态变迁: offline → online ---
      if (!prevWasLive && isLive) {
        const now = timeStr();
        console.log(`[${now}] 🔴 检测到开播: ${roomTitle}`);
        state.wasLive = true;
        state.lastChangeTime = new Date().toISOString();
        saveState(state);
      }

      // --- 状态变迁: online → offline ---
      if (prevWasLive && !isLive) {
        const now = timeStr();
        console.log(`[${now}] 🔵 检测到下播 (${roomTitle || "未知房间"})，等待${OFFLINE_CONFIRM_DELAY_MS / 1000}s后确认...`);

        // 等待广告后台数据延迟
        await sleep(OFFLINE_CONFIRM_DELAY_MS);

        // 二次确认：重新检查是否确实下播（防止短暂断连误判）
        console.log(`[${timeStr()}] 🔄 二次确认直播状态...`);
        const recheck = await checkLiveStatus();
        if (recheck === null || recheck.isLive) {
          console.log(`[${timeStr()}] ⏭ 二次确认仍在线或API失败，保持在线状态`);
          if (recheck?.isLive) state.wasLive = true;  // 恢复在线状态
          saveState(state);
          await sleep(POLL_INTERVAL_MS);
          continue;
        }

        // 确实下播了
        state.wasLive = false;
        state.lastChangeTime = new Date().toISOString();
        saveState(state);

        // 日汇总由 PM2 cron (23:34) 统一调度，live-watcher 不再触发
      }

      // --- 持续在线或持续离线: 仅更新状态 ---
      if (prevWasLive === isLive) {
        // 无变化，不打印（避免日志噪音）
      }

      // 确保状态文件同步
      state.wasLive = isLive;
      saveState(state);

    } catch (e) {
      console.error(`[${timeStr()}] ❌ 主循环异常: ${e.message?.slice(0, 200)}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch(e => {
  console.error(`[${timeStr()}] ❌ 致命错误: ${e.message}`);
  process.exit(1);
});