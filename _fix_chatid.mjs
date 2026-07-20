import { readFileSync, writeFileSync } from "fs";
let c = readFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", "utf-8");

// Fix 1: Replace remaining CHAT_ID in sendMsg
c = c.replace("pushText(LARK_CLI, text, CHAT_ID,", "pushText(LARK_CLI, text, chatId,");

// Fix 2: acknowledgeStart sends to wrong chat - needs chatId param
// Find acknowledgeStart and reportResult, add chatId param
const ackIdx = c.indexOf("async function acknowledgeStart(action, planName, detail)");
const rptIdx = c.indexOf("async function reportResult(ok, action, planName, detail, errMsg)");

// Fix acknowledgeStart: add chatId param and pass it to sendMsg
const ackLineEnd = c.indexOf("\n", ackIdx);
c = c.slice(0, ackIdx) + 
  "async function acknowledgeStart(action, planName, detail, chatId) {" +
  c.slice(ackLineEnd);

// Fix reportResult: add chatId param  
const rptLineEnd = c.indexOf("\n", rptIdx);
c = c.slice(0, rptIdx) +
  "async function reportResult(ok, action, planName, detail, errMsg, chatId) {" +
  c.slice(rptLineEnd);

// Fix 3: find all sendMsg calls inside acknowledgeStart/reportResult and add chatId
// These functions call: await sendMsg(msg);
// Need to change to: await sendMsg(chatId, msg);
// Find the body of acknowledgeStart
const ackBodyStart = c.indexOf("{", ackIdx);
let abc = 1;
let ackEnd = ackBodyStart + 1;
for (; ackEnd < c.length && abc > 0; ackEnd++) {
  if (c[ackEnd] === "{") abc++;
  else if (c[ackEnd] === "}") abc--;
}
let ackBody = c.slice(ackBodyStart, ackEnd - 1);
ackBody = ackBody.replace(/sendMsg\(/g, 'sendMsg(chatId, ');
c = c.slice(0, ackBodyStart) + ackBody + "}" + c.slice(ackEnd);

// Fix reportResult body
const rptBodyStart = c.indexOf("{", c.indexOf("async function reportResult"));
let rbc = 1;
let rptEnd = rptBodyStart + 1;
for (; rptEnd < c.length && rbc > 0; rptEnd++) {
  if (c[rptEnd] === "{") rbc++;
  else if (c[rptEnd] === "}") rbc--;
}
let rptBody = c.slice(rptBodyStart, rptEnd - 1);
rptBody = rptBody.replace(/sendMsg\(/g, 'sendMsg(chatId, ');
c = c.slice(0, rptBodyStart) + rptBody + "}" + c.slice(rptEnd);

// Fix 4: Update dispatch calls to acknowledgeStart/reportResult with chatId
c = c.replace(/acknowledgeStart\(/g, 'acknowledgeStart(chatId, ');
// But don't double-add - the first arg is now chatId from the dispatch call pattern
// Actually dispatch already calls acknowledgeStart('reject', ...) - need to insert chatId
// Let me be more precise: find calls like await acknowledgeStart(type, planName, ...)
// and change to await acknowledgeStart(chatId, type, planName, ...)

// Wait, that changes the signature order. Let me re-think...
// The simpler fix: just add chatId as the LAST parameter

// Undo the acknowledgeStart signature change and do it differently
// Restore original signature but add chatId
const ackIdx2 = c.indexOf("async function acknowledgeStart(action, planName, detail, chatId)");
const ackLineEnd2 = c.indexOf("\n", ackIdx2);
c = c.slice(0, ackIdx2) + 
  "async function acknowledgeStart(chatId, action, planName, detail) {" +
  c.slice(ackLineEnd2);

const rptIdx2 = c.indexOf("async function reportResult(ok, action, planName, detail, errMsg, chatId)");
const rptLineEnd2 = c.indexOf("\n", rptIdx2);
c = c.slice(0, rptIdx2) +
  "async function reportResult(chatId, ok, action, planName, detail, errMsg) {" +
  c.slice(rptLineEnd2);

// Now update all acknowledgeStart/reportResult calls in dispatch to include chatId first
// Pattern: await acknowledgeStart(type, ...) -> await acknowledgeStart(chatId, type, ...)
c = c.replace(/await acknowledgeStart\(/g, 'await acknowledgeStart(chatId, ');
c = c.replace(/await reportResult\(/g, 'await reportResult(chatId, ');

writeFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", c, "utf-8");
console.log("Fixed CHAT_ID and sendMsg param issues");
