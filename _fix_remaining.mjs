import { readFileSync, writeFileSync } from "fs";
let c = readFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", "utf-8");

// Fix 1: loadState/saveState
// Find actual text
const lsIdx = c.indexOf("function loadState() {");
const ssIdx = c.indexOf("function saveState(st)");
// Read the exact text between loadState and the line after saveState
const loadEnd = c.indexOf("\n", c.indexOf("\n", ssIdx)) + 1;
const oldBlock = c.slice(lsIdx, loadEnd);
console.log("Old loadState block:", JSON.stringify(oldBlock.slice(0, 200)));

const newBlock = [
  "function getStateFile(chatId) {",
  "  return chatId === ANCHOR_CHAT_ID ? STATE_FILE_ANCHOR : STATE_FILE;",
  "}",
  "function loadState(chatId) {",
  "  try { return JSON.parse(fs.readFileSync(getStateFile(chatId), 'utf8')); } catch(e) { return { lastMsgId: null }; }",
  "}",
  "function saveState(st, chatId) { fs.writeFileSync(getStateFile(chatId), JSON.stringify(st, null, 2)); }",
].join("\n");

c = c.slice(0, lsIdx) + newBlock + c.slice(loadEnd);

// Fix 2: fetchMessages signature
// Find current fetchMessages
const fmIdx = c.indexOf("async function fetchMessages(pageSize");
const fmLineEnd = c.indexOf("\n", fmIdx);
const fmBody = c.indexOf("{", fmIdx);
// Replace just the signature
c = c.slice(0, fmIdx) + "async function fetchMessages(chatId, pageSize = 10) {" + c.slice(fmBody + 1);

// Fix 2b: Replace CHAT_ID reference inside fetchMessages
const fmStart2 = c.indexOf("async function fetchMessages(chatId,");
// Find the spawnSync call inside
const spawnIdx = c.indexOf("'--chat-id', CHAT_ID,", fmStart2);
if (spawnIdx > 0) {
  c = c.slice(0, spawnIdx) + "'--chat-id', chatId," + c.slice(spawnIdx + "'--chat-id', CHAT_ID,".length);
}

writeFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", c, "utf-8");
console.log("Fixed remaining issues");
