import { readFileSync } from "fs";
const lines = readFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", "utf-8").split("\n");

// Find sendMsg definition
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("async function sendMsg")) {
    console.log("=== sendMsg at line", i+1, "===");
    for (let j = i; j < i + 8 && j < lines.length; j++) {
      console.log((j+1) + ": " + JSON.stringify(lines[j]));
    }
    break;
  }
}

// Find handleAtMention
console.log("");
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("async function handleAtMention")) {
    console.log("=== handleAtMention at line", i+1, "===");
    for (let j = i; j < i + 12 && j < lines.length; j++) {
      console.log((j+1) + ": " + JSON.stringify(lines[j]));
    }
    break;
  }
}
