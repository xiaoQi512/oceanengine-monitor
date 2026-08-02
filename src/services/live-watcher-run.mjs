// src/services/live-watcher-run.mjs - 直播间状态监听运行编排
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { DATA_DIR } from "../config/index.mjs";
import { runMonitorCli } from "./monitor-cli.mjs";
import { loadState, saveState, todayStr, timeStr } from "./live-watcher-state.mjs";
import { checkLiveStatus } from "./live-watcher-check.mjs";
const STATE_FILE = path.join(DATA_DIR, "live-state.json");
const POLL_INTERVAL_MS = 60_000;  // 60s 轮询
const OFFLINE_CONFIRM_DELAY_MS = 5 * 60_000;  // 下播后等5分钟再确认
const OFFLINE_RECHECK_DELAY_MS = 30_000;       // 二次确认间隔

// ====== 主循环 ======

// ====== 主循环 ======
export async function runLiveWatcher() {
  console.log(`[${timeStr()}] 🟢 live-watcher 启动 (轮询间隔 ${POLL_INTERVAL_MS / 1000}s)`);

  let state = loadState(STATE_FILE);
  // 日期更替时重置标记
  const td = todayStr();
  if (state.todayDate !== td) {
    state.todayDate = td;
    saveState(state, STATE_FILE);
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
        saveState(state, STATE_FILE);
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
          saveState(state, STATE_FILE);
          await sleep(POLL_INTERVAL_MS);
          continue;
        }

        // 确实下播了
        state.wasLive = false;
        state.lastChangeTime = new Date().toISOString();
        saveState(state, STATE_FILE);

        // 日汇总由 PM2 cron (23:35) 统一调度，live-watcher 不再触发
      }

      // --- 持续在线或持续离线: 仅更新状态 ---
      if (prevWasLive === isLive) {
        // 无变化，不打印（避免日志噪音）
      }

      // 确保状态文件同步
      state.wasLive = isLive;
      saveState(state, STATE_FILE);

    } catch (e) {
      console.error(`[${timeStr()}] ❌ 主循环异常: ${e.message?.slice(0, 200)}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}
