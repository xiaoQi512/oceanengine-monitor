import { readFileSync, writeFileSync } from "fs";

let c = readFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\oceanengine-daily-report-scheduler.mjs", "utf-8");

// 1. 在 import from monitor-utils 中加入 getTodayShiftWindow
c = c.replace(
  "getLocalDate, findLarkCli, guardFeedbackServer,",
  "getLocalDate, findLarkCli, guardFeedbackServer, getTodayShiftWindow,"
);

// 2. 在去重检查之后、第一次 log 之前加入动态等待
const dedupBlock = c.indexOf("try { writeFileSync(reportDoneMarker");
const afterDedup = c.indexOf("\n", c.indexOf("\n", dedupBlock)) + 1;

const dynamicWait = [
  "",
  "// ====== 0. 动态等待：根据当日排班下播时间，延迟到下播后 5 分钟 ======",
  "var shiftWin = getTodayShiftWindow();",
  "var nowDate = new Date();",
  "var targetTime = new Date(nowDate);",
  "targetTime.setHours(shiftWin.endHour, (shiftWin.endMinute || 0) + 5, 0, 0);",
  "var waitMs = targetTime - nowDate;",
  "if (waitMs > 0 && waitMs < 3600000) {",
  "  var pad = function(n) { return String(n).padStart(2, '0'); };",
  "  log('当日下播时间 ' + pad(shiftWin.endHour) + ':' + pad(shiftWin.endMinute || 0) + '，等待 ' + Math.round(waitMs / 1000 / 60) + ' 分钟后推送');",
  "  await new Promise(function(resolve) { setTimeout(resolve, waitMs); });",
  "}",
  "",
].join("\n");

c = c.slice(0, afterDedup) + dynamicWait + c.slice(afterDedup);

writeFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\oceanengine-daily-report-scheduler.mjs", c, "utf-8");
console.log("Added dynamic wait");
