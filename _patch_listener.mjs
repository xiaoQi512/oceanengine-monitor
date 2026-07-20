import { readFileSync, writeFileSync } from "fs";

const src = "E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs";
let content = readFileSync(src, "utf-8");

// ========== Patch 1: Replace CHAT_ID with dual chat support ==========
// Find: "const CHAT_ID = 'oc_"
const chatIdx = content.indexOf("const CHAT_ID = 'oc_");
const chatLineEnd = content.indexOf("\n", chatIdx);
content = content.slice(0, chatIdx) +
  "const MONITOR_CHAT_ID = 'oc_8deeb3061bdbd43608de252a44c97a25';\n" +
  "const ANCHOR_CHAT_ID = 'oc_b245ee4b255c7b25b7f8d953802c49ff';\n" +
  "const CHAT_IDS = [MONITOR_CHAT_ID, ANCHOR_CHAT_ID];\n" +
  "const CHAT_NAMES = { [MONITOR_CHAT_ID]: 'Monitor', [ANCHOR_CHAT_ID]: 'Anchor' };" +
  content.slice(chatLineEnd);

// ========== Patch 2: Add anchor state file ==========
content = content.replace(
  "const STATE_FILE = path.join(__dirname, 'listener-state.json');",
  "const STATE_FILE = path.join(__dirname, 'listener-state.json');\nconst STATE_FILE_ANCHOR = path.join(__dirname, 'listener-state-anchor.json');"
);

// ========== Patch 3: Add @mention detection functions after isBotMsg ==========
// Find "function isBotMsg"
const botMsgIdx = content.indexOf("function isBotMsg(msg, text)");
// Find end of isBotMsg function (first empty line after the function closing brace)
const afterBotMsg = content.indexOf("\n\n", content.indexOf("}\n", botMsgIdx) + 2);

const atMentionCode = [
  "",
  "// ====== @ mention detection =====",
  "function isAtMention(msg, text) {",
  "  if (text.includes(BOT_APP_ID)) return true;",
  "  try {",
  "    const c = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;",
  "    if (c.mentions) return c.mentions.some(function(m) { return m.id === BOT_APP_ID || m.key === BOT_APP_ID; });",
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

content = content.slice(0, afterBotMsg) + atMentionCode + content.slice(afterBotMsg);

// ========== Patch 4: Update msgText to handle plain text content ==========
// Find "function msgText"
const msgTextIdx = content.indexOf("function msgText(msg)");
const msgTextEnd = content.indexOf("\n}", content.indexOf("}\n", msgTextIdx)) + 2;

const newMsgText = [
  "function msgText(msg) {",
  "  try {",
  "    var c = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;",
  "    return (c.text || '').trim();",
  "  } catch(e) {",
  "    if (typeof msg.content === 'string') return msg.content.trim();",
  "    if (msg.content && msg.content.text) return msg.content.text.trim();",
  "    return '';",
  "  }",
  "}",
].join("\n");

content = content.slice(0, msgTextIdx) + newMsgText + content.slice(msgTextEnd);

// ========== Patch 5: Update loadState/saveState for multi-chat ==========
content = content.replace(
  "function loadState() {\n  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { lastMsgId: null }; }\n}\nfunction saveState(st) { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2)); }",
  "function getStateFile(chatId) {\n  return chatId === ANCHOR_CHAT_ID ? STATE_FILE_ANCHOR : STATE_FILE;\n}\nfunction loadState(chatId) {\n  try { return JSON.parse(fs.readFileSync(getStateFile(chatId), 'utf8')); } catch(e) { return { lastMsgId: null }; }\n}\nfunction saveState(st, chatId) { fs.writeFileSync(getStateFile(chatId), JSON.stringify(st, null, 2)); }"
);

// ========== Patch 6: fetchMessages takes chatId ==========
content = content.replace(
  "async function fetchMessages(pageSize = 10) {\n  try {\n    const r = spawnSync(LARK_CLI, [\n      'im', '+chat-messages-list', '--chat-id', CHAT_ID,",
  "async function fetchMessages(chatId, pageSize = 10) {\n  try {\n    const r = spawnSync(LARK_CLI, [\n      'im', '+chat-messages-list', '--chat-id', chatId,"
);

// ========== Patch 7: sendMsg takes optional chatId ==========
content = content.replace(
  "async function sendMsg(text) {",
  "async function sendMsg(text, chatId) {\n  if (!chatId) chatId = MONITOR_CHAT_ID;"
);
content = content.replace(
  "const r = await pushText(LARK_CLI, text, CHAT_ID,",
  "const r = await pushText(LARK_CLI, text, chatId,"
);

// ========== Patch 8: dispatch takes chatId ==========
content = content.replace(
  "async function dispatch(cmd, sender) {",
  "async function dispatch(cmd, sender, chatId) {\n  if (!chatId) chatId = MONITOR_CHAT_ID;"
);

// Update all sendMsg calls in dispatch to pass chatId
// Find the dispatch function body
const dispStart = content.indexOf("async function dispatch(cmd, sender, chatId)");
const dispBodyStart = content.indexOf("{", dispStart);
let braceC = 0;
let dispEnd = -1;
for (let i = dispBodyStart; i < content.length; i++) {
  if (content[i] === "{") braceC++;
  if (content[i] === "}") { braceC--; if (braceC === 0) { dispEnd = i + 1; break; } }
}

let dispBody = content.slice(dispBodyStart, dispEnd);
// Replace all sendMsg(`...`) calls
dispBody = dispBody.replace(/sendMsg\(`/g, 'sendMsg(chatId, `');
// Replace sendMsg('...') calls  
dispBody = dispBody.replace(/sendMsg\('/g, "sendMsg(chatId, '");

content = content.slice(0, dispBodyStart) + dispBody + content.slice(dispEnd);

// ========== Patch 9: Add handleAtMention function before main ==========
const mainIdx = content.indexOf("async function main()");
const atHandler = [
  "",
  "// ====== @mention reply handler =====",
  "async function handleAtMention(text, chatId) {",
  "  var cleaned = cleanAtText(text);",
  "  console.log('[listener] @mention in', CHAT_NAMES[chatId]||chatId, ':', cleaned);",
  "  if (!cleaned) {",
  "    await sendMsg(chatId, 'I am here. Commands: pause/stop/resume/budget/reject/execute/status');",
  "    return;",
  "  }",
  "  if (/today|now|current|status|data|spend/i.test(cleaned)) {",
  "    await sendMsg(chatId, 'Received. Check Dashboard for current data, or wait for next 5-min report.\\nFor operations use: pause/stop/resume/budget/status');",
  "    return;",
  "  }",
  "  if (/hello|hi|hey/i.test(cleaned)) {",
  "    await sendMsg(chatId, 'Hello! Commands: pause/stop/resume/budget/reject/execute/status\\nExample: pause [plan_name]');",
  "    return;",
  "  }",
  "  await sendMsg(chatId, 'Received. Available commands:\\npause/stop/resume [plan_name]\\nbudget [plan_name] [amount]\\nreject / execute / status');",
  "}",
  "",
].join("\n");

content = content.slice(0, mainIdx) + atHandler + content.slice(mainIdx);

// ========== Patch 10: Rewrite main() for dual-chat polling ==========
// Find main function boundaries
const mainStartIdx = content.indexOf("async function main()");
const mainBodyStart = content.indexOf("{", mainStartIdx);
let mbc = 0;
let mainEndIdx = -1;
for (let i = mainBodyStart; i < content.length; i++) {
  if (content[i] === "{") mbc++;
  if (content[i] === "}") { mbc--; if (mbc === 0) { mainEndIdx = i + 1; break; } }
}

const newMain = [
  "async function main() {",
  "  console.log('[listener] dual-chat monitor: mon=' + MONITOR_CHAT_ID + ' anchor=' + ANCHOR_CHAT_ID);",
  "  console.log('[listener] cmds: pause/stop/resume/budget/reject/execute/status + @reply');",
  "",
  "  var states = {};",
  "  for (var _i = 0; _i < CHAT_IDS.length; _i++) {",
  "    var _cid = CHAT_IDS[_i];",
  "    var st = loadState(_cid);",
  "    if (!st.lastMsgId) {",
  "      var ms = await fetchMessages(_cid, 50);",
  "      if (ms.length > 0) { st.lastMsgId = ms[0].message_id; saveState(st, _cid); console.log('[listener] ' + CHAT_NAMES[_cid] + ' skip ' + ms.length + ' msgs'); }",
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
  "        for (var _k = 0; _k < msgs.length; _k++) { if (msgs[_k].message_id === _st.lastMsgId) break; fresh.push(msgs[_k]); }",
  "        if (!fresh.length) continue;",
  "        fresh.reverse();",
  "        for (var _m = 0; _m < fresh.length; _m++) {",
  "          var m = fresh[_m];",
  "          var t = msgText(m);",
  "          if (isBotMsg(m, t)) { _st.lastMsgId = m.message_id; continue; }",
  "          var c = parseCommand(m);",
  "          if (c) {",
  "            console.log('[' + new Date().toLocaleTimeString() + '] [' + CHAT_NAMES[cid] + '] ' + (m.sender?.name||'?') + ' : ' + c.raw);",
  "            try { await dispatch(c, m.sender?.name||'unknown', cid); } catch(e) { console.error('[dispatch]', e.message); await sendMsg(cid, 'Error: ' + e.message); }",
  "          } else if (isAtMention(m, t)) {",
  "            console.log('[' + new Date().toLocaleTimeString() + '] [' + CHAT_NAMES[cid] + '] @' + (m.sender?.name||'?') + ' : ' + t.slice(0,80));",
  "            try { await handleAtMention(t, cid); } catch(e) { console.error('[at]', e.message); }",
  "          }",
  "          _st.lastMsgId = m.message_id;",
  "          saveState(_st, cid);",
  "        }",
  "      } catch(e) { console.error('[poll-' + cid + ']', e.message); }",
  "    }",
  "  }, 10000);",
  "}",
].join("\n");

content = content.slice(0, mainStartIdx) + newMain + content.slice(mainEndIdx);

writeFileSync(src, content, "utf-8");
console.log("All patches applied successfully");
