import { readFileSync } from "fs";
const c = readFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", "utf-8");

const checks = [
  ["MONITOR_CHAT_ID", c.includes("MONITOR_CHAT_ID")],
  ["ANCHOR_CHAT_ID", c.includes("ANCHOR_CHAT_ID")],
  ["CHAT_IDS array", c.includes("CHAT_IDS = [")],
  ["STATE_FILE_ANCHOR", c.includes("STATE_FILE_ANCHOR")],
  ["getStateFile fn", c.includes("function getStateFile")],
  ["loadState(chatId)", c.includes("loadState(chatId)")],
  ["saveState(st, chatId)", c.includes("saveState(st, chatId)")],
  ["fetchMessages(chatId", c.includes("fetchMessages(chatId,")],
  ["sendMsg(chatId", c.includes("sendMsg(chatId")],
  ["dispatch(cmd, sender, chatId", c.includes("dispatch(cmd, sender, chatId")],
  ["isAtMention fn", c.includes("function isAtMention")],
  ["cleanAtText fn", c.includes("function cleanAtText")],
  ["handleAtMention fn", c.includes("function handleAtMention")],
  ["dual-chat in main", c.includes("dual-chat")],
  ["BOT_APP_ID check", c.includes("BOT_APP_ID)")],
  ["CHAT_IDS loop", c.includes("CHAT_IDS.length")],
];

console.log("=== Final Verification ===");
let allOk = true;
for (const [name, ok] of checks) {
  console.log((ok ? "  OK" : "  FAIL") + ": " + name);
  if (!ok) allOk = false;
}
console.log(allOk ? "\nALL PASSED" : "\nSOME FAILED");
