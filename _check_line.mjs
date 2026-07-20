import { readFileSync } from "fs";
const lines = readFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", "utf-8").split("\n");
for (let i = 400; i < 415 && i < lines.length; i++) {
  console.log((i+1) + ": " + JSON.stringify(lines[i]));
}
