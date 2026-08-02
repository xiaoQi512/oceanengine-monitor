// oceanengine-daily-summary.mjs — 大号日汇报（管理层版）
// PM2 cron 每天 23:35 定时触发，也由 shift-pusher EOD 在最后一场直播结束后约4分钟触发
// 不做“今日已推送”标记，确保直播结束后仍能推送当日完整数据
// 推送目标: 上架群
//
// 环境变量：
//   OEC_SILENT=1   静默模式
//   OEC_DRY_RUN=1  只采集不推送

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, getLocalDate } from "../utils/monitor-utils.mjs";
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
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === "1";
const IS_EOD = process.env.DAILY_SUMMARY_EOD === "1";
const IS_SCHEDULED_FALLBACK = process.env.DAILY_SUMMARY_FALLBACK === "1";


// ====== 主流程 ======
async function main() {
  log("🚀 日汇报推送启动");

  const eodMarker = path.join(DATA_DIR, `daily-summary-eod-done-${getLocalDate()}.json`);
  if (IS_SCHEDULED_FALLBACK && !OEC_DRY_RUN && fs.existsSync(eodMarker)) {
    log("⏭ 已由直播结束后 EOD 推送，23:35 兜底跳过");
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
  if (IS_EOD) {
    try { fs.writeFileSync(eodMarker, JSON.stringify({ doneAt: new Date().toISOString() })); } catch {}
  }
}

export function runCli() {
  runMonitorCli({ run: main });
}
