import { readFileSync } from "fs";
const src = "E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs";
const lines = readFileSync(src, "utf-8").split("\n");
// Show from where the old main() ended and what's around it
for (let i = 230; i < 260 && i < lines.length; i++) {
  console.log((i+1) + ": " + JSON.stringify(lines[i]));
}
