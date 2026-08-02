// oceanengine-daily-summary.mjs — 大号日汇报（管理层版）
// PM2 cron 每天 23:35 定时触发：HTTP API 拉直播全天 + 短视频全天 → 合并 → 推飞书群
// 推送目标: 上架群
//
// 环境变量：
//   OEC_SILENT=1   静默模式
//   OEC_FORCE=1    强制执行（测试用）
//   OEC_DRY_RUN=1  只采集不推送

import fs from "node:fs";
import path from "node:path";
import {
  DATA_DIR, getLocalDate,
} from "../utils/monitor-utils.mjs";
import { runMonitorCli } from "./monitor-cli.mjs";
import {
  log,
  todayDateCN,
  getTodayDateStr,
  getSessionsForDate,
  fetchLiveAllDay,
  fetchVideoAllDay,
  readAnchorNames,
  pushToLark,
  buildDailySummaryMessage,
} from "./daily-summary-core.mjs";
const OEC_FORCE = process.env.OEC_FORCE === "1";
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === "1";


// ====== 主流程 ======
async function main() {
  log("🚀 日汇报推送启动");

  const todayMarker = path.join(DATA_DIR, `daily-summary-done-${getLocalDate()}.json`);
  if (!OEC_FORCE && !OEC_DRY_RUN && fs.existsSync(todayMarker)) {
    log("⚠️ 日汇报今日已推送过，跳过");
    return;
  }

  const live = await fetchLiveAllDay();
  const video = await fetchVideoAllDay();
  const anchors = readAnchorNames();

  const sessions = getSessionsForDate(getTodayDateStr());
  const msgText = buildDailySummaryMessage({ live, video, anchors, sessions, todayLabel: todayDateCN() });

  log(`📝 推送内容预览:\n${msgText}\n`);

  if (OEC_DRY_RUN) {
    log("🧪 DRY_RUN，不推送");
    return;
  }

  pushToLark(msgText);
  log("🏁 日汇报完成");
  try { fs.writeFileSync(todayMarker, JSON.stringify({ doneAt: new Date().toISOString() })); } catch {}
}

export function runCli() {
  runMonitorCli({ run: main });
}
