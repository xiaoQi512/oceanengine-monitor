import { readFileSync } from "fs";
const c = readFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", "utf-8");
const lines = c.split("\n");

// Find getStateFile
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("getStateFile") || lines[i].includes("loadState") || lines[i].includes("saveState")) {
    console.log((i+1) + ": " + JSON.stringify(lines[i]));
  }
}
console.log("---");
// Find fetchMessages
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("fetchMessages")) {
    console.log((i+1) + ": " + JSON.stringify(lines[i]));
  }
}
