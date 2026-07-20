import { readFileSync } from "fs";
const c = readFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", "utf-8");

const checks = [
  ["MONITOR_CHAT_ID", c.includes("MONITOR_CHAT_ID")],
  ["ANCHOR_CHAT_ID", c.includes("ANCHOR_CHAT_ID")],
  ["CHAT_IDS array", c.includes("CHAT_IDS = [")],
  ["STATE_FILE_ANCHOR", c.includes("STATE_FILE_ANCHOR")],
  ["isAtMention fn", c.includes("function isAtMention")],
  ["cleanAtText fn", c.includes("function cleanAtText")],
  ["handleAtMention fn", c.includes("function handleAtMention")],
  ["getStateFile fn", c.includes("function getStateFile")],
  ["fetchMessages(chatId", c.includes("fetchMessages(chatId")],
  ["sendMsg(chatId", c.includes("sendMsg(chatId")],
  ["dispatch(cmd, sender, chatId", c.includes("dispatch(cmd, sender, chatId")],
  ["dual-chat log", c.includes("dual-chat")],
  ["BOT_APP_ID in isAt", c.includes("BOT_APP_ID)")],
  ["@小七 regex", c.includes("@\\u5c0f\\u4e03")],
];

console.log("=== Verification ===");
let allOk = true;
for (const [name, ok] of checks) {
  console.log((ok ? "  OK" : "  FAIL") + ": " + name);
  if (!ok) allOk = false;
}
console.log(allOk ? "\nAll checks passed" : "\nSome checks FAILED");
