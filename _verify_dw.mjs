import { readFileSync } from "fs";
const c = readFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\oceanengine-daily-report-scheduler.mjs", "utf-8");
const lines = c.split("\n");

// Show dynamic wait section
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("动态等待")) {
    for (let j = i; j < i + 15 && j < lines.length; j++) {
      console.log((j+1) + ": " + JSON.stringify(lines[j]));
    }
    break;
  }
}

console.log("\nHas getTodayShiftWindow:", c.includes("getTodayShiftWindow"));
console.log("Has dynamic wait:", c.includes("shiftWin.endHour"));
