import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, "feishu-listener.mjs");
const orig = readFileSync(src, "utf-8");

// Strategy: replace by finding anchor strings and using slices
let c = orig;

// === 1. CHAT_ID -> dual chat ===
c = c.replace(
  "const CHAT_ID = 'oc_8deeb3061bdbd43608de252a44c97a25';",
  "const MONITOR_CHAT_ID = 'oc_8deeb3061bdbd43608de252a44c97a25';\nconst ANCHOR_CHAT_ID = 'oc_b245ee4b255c7b25b7f8d953802c49ff';\nconst CHAT_IDS = [MONITOR_CHAT_ID, ANCHOR_CHAT_ID];\nconst CHAT_NAMES = { [MONITOR_CHAT_ID]: 'monitor', [ANCHOR_CHAT_ID]: 'anchor' };"
);

// === 2. Add second state file ===
c = c.replace(
  "const STATE_FILE = path.join(__dirname, 'listener-state.json');",
  "const STATE_FILE = path.join(__dirname, 'listener-state.json');\nconst STATE_FILE_ANCHOR = path.join(__dirname, 'listener-state-anchor.json');"
);

// === 3. Update msgText for plain text content ===
const oldMsgText = c.slice(
  c.indexOf("function msgText(msg)"),
  c.indexOf("\n}\n\n// ====== 三阶段反馈", c.indexOf("function msgText(msg)")) + 3
);
// Find the actual end of msgText function
const msgStart = c.indexOf("function msgText(msg)");
const msgBodyStart = c.indexOf("{", msgStart);
let bc = 1;
let msgEnd = msgBodyStart + 1;
for (; msgEnd < c.length && bc > 0; msgEnd++) {
  if (c[msgEnd] === "{") bc++;
  else if (c[msgEnd] === "}") bc--;
}
c = c.slice(0, msgStart) +
  "function msgText(msg) {\n  try {\n    var c$ = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;\n    return (c$.text || '').trim();\n  } catch(e) {\n    if (typeof msg.content === 'string') return msg.content.trim();\n    if (msg.content && msg.content.text) return msg.content.text.trim();\n    return '';\n  }\n}" +
  c.slice(msgEnd);

// === 4. Add @mention detection after isBotMsg ===
const isBotStart = c.indexOf("function isBotMsg(msg, text)");
let bc2 = 1;
let isBotEnd = c.indexOf("{", isBotStart) + 1;
for (; isBotEnd < c.length && bc2 > 0; isBotEnd++) {
  if (c[isBotEnd] === "{") bc2++;
  else if (c[isBotEnd] === "}") bc2--;
}
// Find next double newline after isBotMsg
const afterBot = c.indexOf("\n\n", isBotEnd);
const atCode = [
  "",
  "// ====== @ mention detection =====",
  "function isAtMention(msg, text) {",
  "  if (text.indexOf(BOT_APP_ID) >= 0) return true;",
  "  try {",
  "    var c$ = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;",
  "    if (c$.mentions) {",
  "      for (var mi = 0; mi < c$.mentions.length; mi++) {",
  "        if (c$.mentions[mi].id === BOT_APP_ID || c$.mentions[mi].key === BOT_APP_ID) return true;",
  "      }",
  "    }",
  "  } catch(e) {}",
  "  if (/@\\u5c0f\\u4e03/.test(text)) return true;",
  "  return false;",
  "}",
  "",
  "function cleanAtText(text) {",
  "  return text.replace(/<at[^>]*>[^<]*<\\/at>/gi, '').replace(/@\\u5c0f\\u4e03\\s*/g, '').trim();",
  "}",
  "",
].join("\n");
c = c.slice(0, afterBot) + atCode + c.slice(afterBot);

// === 5. loadState/saveState multi-chat ===
c = c.replace(
  "function loadState() {\n  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { lastMsgId: null }; }\n}\nfunction saveState(st) { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2)); }",
  "function getStateFile(chatId) {\n  return chatId === ANCHOR_CHAT_ID ? STATE_FILE_ANCHOR : STATE_FILE;\n}\nfunction loadState(chatId) {\n  try { return JSON.parse(fs.readFileSync(getStateFile(chatId), 'utf8')); } catch(e) { return { lastMsgId: null }; }\n}\nfunction saveState(st, chatId) { fs.writeFileSync(getStateFile(chatId), JSON.stringify(st, null, 2)); }"
);

// === 6. fetchMessages takes chatId ===
c = c.replace(
  "async function fetchMessages(pageSize = 10) {\n  try {\n    const r = spawnSync(LARK_CLI, [\n      'im', '+chat-messages-list', '--chat-id', CHAT_ID,",
  "async function fetchMessages(chatId, pageSize = 10) {\n  try {\n    const r = spawnSync(LARK_CLI, [\n      'im', '+chat-messages-list', '--chat-id', chatId,"
);

// === 7. sendMsg takes optional chatId ===
c = c.replace(
  "async function sendMsg(text) {\n  if (process.env.OEC_SILENT !== '1') console.log('  -->', text.replace(/\\n/g, ' '));\n  const r = await pushText(LARK_CLI, text, CHAT_ID,",
  "async function sendMsg(chatId, text) {\n  if (!chatId) chatId = MONITOR_CHAT_ID;\n  if (process.env.OEC_SILENT !== '1') console.log('  -->', text.replace(/\\n/g, ' '));\n  const r = await pushText(LARK_CLI, text, chatId,"
);

// === 8. dispatch takes chatId; replace sendMsg calls ===
// Find the exact dispatch function and replace
const dispStart = c.indexOf("async function dispatch(cmd, sender) {");
const dispLineEnd = c.indexOf("\n", dispStart);
const dispBodyStart = dispLineEnd + 1;

// Count braces to find dispatch end
let dbc = 1;
let dispEnd = dispBodyStart;
let inTemplate = false;
for (; dispEnd < c.length && dbc > 0; dispEnd++) {
  const ch = c[dispEnd];
  if (ch === '`') inTemplate = !inTemplate;
  if (!inTemplate) {
    if (ch === '{') dbc++;
    else if (ch === '}') dbc--;
  }
}

// Get dispatch body
let dispBody = c.slice(dispBodyStart, dispEnd - 1); // exclude closing }

// Replace sendMsg calls to use chatId as first arg
// Pattern: sendMsg(` -> sendMsg(chatId, `
// Pattern: sendMsg(' -> sendMsg(chatId, '
dispBody = dispBody.replace(/sendMsg\(`/g, 'sendMsg(chatId, `');
dispBody = dispBody.replace(/sendMsg\('/g, "sendMsg(chatId, '");

c = c.slice(0, dispStart) + 
  "async function dispatch(cmd, sender, chatId) {\n  if (!chatId) chatId = MONITOR_CHAT_ID;\n" +
  dispBody + 
  "}" +
  c.slice(dispEnd);

// === 9. Add handleAtMention before main ===
const mainStart = c.lastIndexOf("async function main()");
const atHandler = [
  "",
  "// ====== @mention reply handler =====",
  "async function handleAtMention(text, chatId) {",
  "  var cleaned = cleanAtText(text);",
  "  console.log('[listener] @ in ' + (CHAT_NAMES[chatId]||chatId) + ': ' + cleaned);",
  "  if (!cleaned) {",
  "    await sendMsg(chatId, 'I am here. Commands: pause/stop/resume/budget/reject/execute/status');",
  "    return;",
  "  }",
  "  if (/today|now|current|status|data|spend|report/i.test(cleaned)) {",
  "    await sendMsg(chatId, 'Received. Check Dashboard for current data, or wait for next 5-min report.\\nFor operations: pause/stop/resume/budget/status');",
  "    return;",
  "  }",
  "  if (/hello|hi|hey|test/i.test(cleaned)) {",
  "    await sendMsg(chatId, 'Hello! Commands: pause/stop/resume/budget/reject/execute/status');",
  "    return;",
  "  }",
  "  await sendMsg(chatId, 'Received. Available commands:\\npause/stop/resume plan_name\\nbudget plan_name amount\\nreject / execute / status');",
  "}",
  "",
].join("\n");
c = c.slice(0, mainStart) + atHandler + c.slice(mainStart);

// === 10. Rewrite main() for dual-chat ===
const mnStart = c.lastIndexOf("async function main()");
const mnBodyStart = c.indexOf("{", mnStart);

// Count braces for main
let mbc = 1;
let mnEnd = mnBodyStart + 1;
let inTpl = false;
for (; mnEnd < c.length && mbc > 0; mnEnd++) {
  const ch = c[mnEnd];
  if (ch === '`') inTpl = !inTpl;
  if (!inTpl) {
    if (ch === '{') mbc++;
    else if (ch === '}') mbc--;
  }
}

const newMain = [
  "async function main() {",
  "  console.log('[listener] dual-chat: mon=' + MONITOR_CHAT_ID + ' anchor=' + ANCHOR_CHAT_ID);",
  "  console.log('[listener] cmds: pause/stop/resume/budget/reject/execute/status + @reply');",
  "",
  "  var states = {};",
  "  for (var _i = 0; _i < CHAT_IDS.length; _i++) {",
  "    var _cid = CHAT_IDS[_i];",
  "    var st = loadState(_cid);",
  "    if (!st.lastMsgId) {",
  "      var ms = await fetchMessages(_cid, 50);",
  "      if (ms.length > 0) { st.lastMsgId = ms[0].message_id; saveState(st, _cid);",
  "        console.log('[listener] ' + CHAT_NAMES[_cid] + ' skip ' + ms.length + ' msgs'); }",
  "    }",
  "    states[_cid] = st;",
  "    console.log('[listener] ' + CHAT_NAMES[_cid] + ' lastMsgId=' + (st.lastMsgId || 'none'));",
  "  }",
  "",
  "  console.log('[listener] polling every 10s\\n');",
  "  setInterval(async function() {",
  "    for (var _j = 0; _j < CHAT_IDS.length; _j++) {",
  "      var cid = CHAT_IDS[_j];",
  "      try {",
  "        var msgs = await fetchMessages(cid, 10);",
  "        if (!msgs.length) continue;",
  "        var _st = states[cid];",
  "        var fresh = [];",
  "        for (var _k = 0; _k < msgs.length; _k++) {",
  "          if (msgs[_k].message_id === _st.lastMsgId) break;",
  "          fresh.push(msgs[_k]);",
  "        }",
  "        if (!fresh.length) continue;",
  "        fresh.reverse();",
  "        for (var _m = 0; _m < fresh.length; _m++) {",
  "          var m = fresh[_m];",
  "          var t = msgText(m);",
  "          if (isBotMsg(m, t)) { _st.lastMsgId = m.message_id; continue; }",
  "          var cmd = parseCommand(m);",
  "          if (cmd) {",
  "            console.log('[' + new Date().toLocaleTimeString() + '] [' + CHAT_NAMES[cid] + '] ' + (m.sender && m.sender.name || '?') + ' : ' + cmd.raw);",
  "            try { await dispatch(cmd, (m.sender && m.sender.name) || 'unknown', cid); }",
  "            catch(e) { console.error('[dispatch]', e.message); await sendMsg(cid, 'Error: ' + e.message); }",
  "          } else if (isAtMention(m, t)) {",
  "            console.log('[' + new Date().toLocaleTimeString() + '] [' + CHAT_NAMES[cid] + '] @' + (m.sender && m.sender.name || '?') + ' : ' + t.slice(0, 80));",
  "            try { await handleAtMention(t, cid); }",
  "            catch(e) { console.error('[at]', e.message); }",
  "          }",
  "          _st.lastMsgId = m.message_id;",
  "          saveState(_st, cid);",
  "        }",
  "      } catch(e) { console.error('[poll-' + cid + ']', e.message); }",
  "    }",
  "  }, 10000);",
  "}",
].join("\n");

c = c.slice(0, mnStart) + newMain + c.slice(mnEnd);

// === Write output ===
writeFileSync(src, c, "utf-8");
console.log("Built feishu-listener.mjs");
console.log("Total lines:", c.split("\n").length);
