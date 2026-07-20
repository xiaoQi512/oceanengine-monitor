import { readFileSync } from "fs";
const c = readFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", "utf-8");
const lines = c.split("\n");

// Find all remaining CHAT_ID references that aren't MONITOR_ or ANCHOR_
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  // Match CHAT_ID but not MONITOR_CHAT_ID or ANCHOR_CHAT_ID
  if (/\bCHAT_ID\b/.test(l) && !l.includes("MONITOR_CHAT_ID") && !l.includes("ANCHOR_CHAT_ID") && !l.includes("CHAT_IDS") && !l.includes("CHAT_NAMES") && !l.includes("//")) {
    console.log((i+1) + ": " + JSON.stringify(l));
  }
}
