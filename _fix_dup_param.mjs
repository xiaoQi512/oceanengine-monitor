import { readFileSync, writeFileSync } from "fs";
let c = readFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", "utf-8");

// Fix: acknowledgeStart has duplicate chatId
// Find the line: async function acknowledgeStart(chatId, action, planName, detail, chatId) {
const badSig = "async function acknowledgeStart(chatId, action, planName, detail, chatId) {";
const goodSig = "async function acknowledgeStart(chatId, action, planName, detail) {";
c = c.replace(badSig, goodSig);

// Also check reportResult for same issue
const badSig2 = "async function reportResult(chatId, ok, action, planName, detail, errMsg, chatId) {";
if (c.includes(badSig2)) {
  c = c.replace(badSig2, "async function reportResult(chatId, ok, action, planName, detail, errMsg) {");
}

writeFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", c, "utf-8");
console.log("Fixed duplicate param");
