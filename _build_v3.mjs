import { readFileSync, writeFileSync } from "fs";

const src = "E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs";
// Restore from backup first to get clean original
const bak = readFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.bak.mjs", "utf-8");
const lines = bak.split("\n");
const out = [];

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  
  // 1. CHAT_ID -> dual
  if (line.includes("const CHAT_ID = 'oc_8deeb3061bdbd43608de252a44c97a25'")) {
    out.push("const MONITOR_CHAT_ID = 'oc_8deeb3061bdbd43608de252a44c97a25';");
    out.push("const ANCHOR_CHAT_ID = 'oc_b245ee4b255c7b25b7f8d953802c49ff';");
    out.push("const CHAT_IDS = [MONITOR_CHAT_ID, ANCHOR_CHAT_ID];");
    out.push("var CHAT_NAMES = {}; CHAT_NAMES[MONITOR_CHAT_ID] = 'monitor'; CHAT_NAMES[ANCHOR_CHAT_ID] = 'anchor';");
    continue;
  }
  
  // 2. STATE_FILE anchor
  if (line.includes("const STATE_FILE = path.join(__dirname, 'listener-state.json')")) {
    out.push(line);
    out.push("const STATE_FILE_ANCHOR = path.join(__dirname, 'listener-state-anchor.json');");
    continue;
  }
  
  // 3. msgText
  if (line.includes("function msgText(msg) {")) {
    out.push("function msgText(msg) {");
    out.push("  try {");
    out.push("    var c$ = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;");
    out.push("    return (c$.text || '').trim();");
    out.push("  } catch(e) {");
    out.push("    if (typeof msg.content === 'string') return msg.content.trim();");
    out.push("    if (msg.content && msg.content.text) return msg.content.text.trim();");
    out.push("    return '';");
    out.push("  }");
    out.push("}");
    let bc = 1; i++;
    for (; i < lines.length && bc > 0; i++) {
      for (const ch of lines[i]) { if (ch === "{") bc++; else if (ch === "}") bc--; }
    }
    i--; continue;
  }
  
  // 4. isBotMsg -> + @mention fns
  if (line.includes("function isBotMsg(msg, text)")) {
    out.push(line);
    let bc = 1; i++;
    for (; i < lines.length && bc > 0; i++) { out.push(lines[i]); for (const ch of lines[i]) { if (ch === "{") bc++; else if (ch === "}") bc--; } }
    i--;
    out.push("");
    out.push("function isAtMention(msg, text) {");
    out.push("  if (text.indexOf(BOT_APP_ID) >= 0) return true;");
    out.push("  try {");
    out.push("    var c$ = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;");
    out.push("    if (c$.mentions) { for (var mi = 0; mi < c$.mentions.length; mi++) { if (c$.mentions[mi].id === BOT_APP_ID || c$.mentions[mi].key === BOT_APP_ID) return true; } }");
    out.push("  } catch(e) {}");
    out.push("  if (/@\\u5c0f\\u4e03/.test(text)) return true;");
    out.push("  return false;");
    out.push("}");
    out.push("");
    out.push("function cleanAtText(text) {");
    out.push("  return text.replace(/<at[^>]*>[^<]*<\\/at>/gi, '').replace(/@\\u5c0f\\u4e03\\s*/g, '').trim();");
    out.push("}");
    continue;
  }
  
  // 5. loadState/saveState
  if (line.includes("function loadState() {")) {
    out.push("function getStateFile(chatId) { return chatId === ANCHOR_CHAT_ID ? STATE_FILE_ANCHOR : STATE_FILE; }");
    out.push("function loadState(chatId) {");
    out.push("  try { return JSON.parse(fs.readFileSync(getStateFile(chatId), 'utf8')); } catch(e) { return { lastMsgId: null }; }");
    out.push("}");
    while (i < lines.length && !lines[i].includes("async function fetchMessages")) i++;
    out.push("function saveState(st, chatId) { fs.writeFileSync(getStateFile(chatId), JSON.stringify(st, null, 2)); }");
    out.push("");
    i--; continue;
  }
  
  // 6. fetchMessages
  if (line.includes("async function fetchMessages(pageSize = 10) {")) {
    out.push("async function fetchMessages(chatId, pageSize = 10) {");
    continue;
  }
  if (line.includes("'--chat-id', CHAT_ID,")) {
    out.push(line.replace("CHAT_ID", "chatId"));
    continue;
  }
  
  // 7. sendMsg
  if (line.includes("async function sendMsg(text) {")) {
    out.push("async function sendMsg(chatId, text) {");
    out.push("  if (!chatId) chatId = MONITOR_CHAT_ID;");
    continue;
  }
  if (line.includes("pushText(LARK_CLI, text, CHAT_ID,")) {
    out.push(line.replace("CHAT_ID", "chatId"));
    continue;
  }
  
  // 8. acknowledgeStart/reportResult
  if (line.includes("async function acknowledgeStart(action, planName, detail) {")) {
    out.push("async function acknowledgeStart(chatId, action, planName, detail) {");
    continue;
  }
  if (line.includes("async function reportResult(ok, action, planName, detail, errMsg) {")) {
    out.push("async function reportResult(chatId, ok, action, planName, detail, errMsg) {");
    continue;
  }
  
  // 9. dispatch
  if (line.includes("async function dispatch(cmd, sender) {")) {
    out.push("async function dispatch(cmd, sender, chatId) {");
    out.push("  if (!chatId) chatId = MONITOR_CHAT_ID;");
    continue;
  }
  
  // 10. main() -> output handleAtMention + new main, skip old main
  if (line.includes("async function main()")) {
    // Output handleAtMention
    out.push("");
    out.push("async function handleAtMention(text, chatId) {");
    out.push("  var cleaned = cleanAtText(text);");
    out.push("  console.log('[listener] @ in ' + (CHAT_NAMES[chatId]||chatId) + ': ' + cleaned);");
    out.push("  if (!cleaned) { await sendMsg(chatId, 'I am here.'); return; }");
    out.push("  if (/today|now|current|status|data|spend/i.test(cleaned)) { await sendMsg(chatId, 'Check Dashboard or wait for next report.'); return; }");
    out.push("  if (/hello|hi|hey|test/i.test(cleaned)) { await sendMsg(chatId, 'Hello! Commands: pause/stop/resume/budget/reject/execute/status'); return; }");
    out.push("  await sendMsg(chatId, 'Commands: pause/stop/resume plan / budget plan amount / reject / execute / status');");
    out.push("}");
    out.push("");
    
    // Output new main
    out.push("async function main() {");
    out.push("  console.log('[listener] dual-chat mon=' + MONITOR_CHAT_ID + ' anchor=' + ANCHOR_CHAT_ID);");
    out.push("  var states = {};");
    out.push("  for (var _i = 0; _i < CHAT_IDS.length; _i++) {");
    out.push("    var _cid = CHAT_IDS[_i];");
    out.push("    var st = loadState(_cid);");
    out.push("    if (!st.lastMsgId) {");
    out.push("      var ms = await fetchMessages(_cid, 50);");
    out.push("      if (ms.length > 0) { st.lastMsgId = ms[0].message_id; saveState(st, _cid); console.log('[listener] ' + CHAT_NAMES[_cid] + ' skip ' + ms.length + ' msgs'); }");
    out.push("    }");
    out.push("    states[_cid] = st;");
    out.push("    console.log('[listener] ' + CHAT_NAMES[_cid] + ' lastMsgId=' + (st.lastMsgId || 'none'));");
    out.push("  }");
    out.push("  console.log('[listener] polling every 10s');");
    out.push("  setInterval(async function() {");
    out.push("    for (var _j = 0; _j < CHAT_IDS.length; _j++) {");
    out.push("      var cid = CHAT_IDS[_j];");
    out.push("      try {");
    out.push("        var msgs = await fetchMessages(cid, 10);");
    out.push("        if (!msgs.length) continue;");
    out.push("        var _st = states[cid];");
    out.push("        var fresh = [];");
    out.push("        for (var _k = 0; _k < msgs.length; _k++) { if (msgs[_k].message_id === _st.lastMsgId) break; fresh.push(msgs[_k]); }");
    out.push("        if (!fresh.length) continue;");
    out.push("        fresh.reverse();");
    out.push("        for (var _m = 0; _m < fresh.length; _m++) {");
    out.push("          var m = fresh[_m];");
    out.push("          var t = msgText(m);");
    out.push("          if (isBotMsg(m, t)) { _st.lastMsgId = m.message_id; continue; }");
    out.push("          var cmd = parseCommand(m);");
    out.push("          if (cmd) {");
    out.push("            console.log('[' + new Date().toLocaleTimeString() + '] [' + CHAT_NAMES[cid] + '] ' + (m.sender && m.sender.name || '?') + ' : ' + cmd.raw);");
    out.push("            try { await dispatch(cmd, (m.sender && m.sender.name) || 'unknown', cid); }");
    out.push("            catch(e) { console.error('[dispatch]', e.message); await sendMsg(cid, 'Error: ' + e.message); }");
    out.push("          } else if (isAtMention(m, t)) {");
    out.push("            console.log('[' + new Date().toLocaleTimeString() + '] [' + CHAT_NAMES[cid] + '] @' + (m.sender && m.sender.name || '?') + ' : ' + t.slice(0, 80));");
    out.push("            try { await handleAtMention(t, cid); }");
    out.push("            catch(e) { console.error('[at]', e.message); }");
    out.push("          }");
    out.push("          _st.lastMsgId = m.message_id; saveState(_st, cid);");
    out.push("        }");
    out.push("      } catch(e) { console.error('[poll-' + cid + ']', e.message); }");
    out.push("    }");
    out.push("  }, 10000);");
    out.push("}");
    
    // Skip old main body
    let bc = 1;
    i++; // skip "{"
    for (; i < lines.length && bc > 0; i++) {
      for (const ch of lines[i]) { if (ch === "{") bc++; else if (ch === "}") bc--; }
    }
    i--;
    continue;
  }
  
  // 11. Fix calls in dispatch/acknowledgeStart/reportResult
  let fixed = line;
  if (fixed.includes("await sendMsg(`") && !fixed.includes("await sendMsg(chatId")) fixed = fixed.replace("await sendMsg(`", "await sendMsg(chatId, `");
  if (fixed.includes("await sendMsg('") && !fixed.includes("await sendMsg(chatId")) fixed = fixed.replace("await sendMsg('", "await sendMsg(chatId, '");
  if (fixed.includes("await acknowledgeStart(") && !fixed.includes("await acknowledgeStart(chatId")) fixed = fixed.replace("await acknowledgeStart(", "await acknowledgeStart(chatId, ");
  if (fixed.includes("await reportResult(") && !fixed.includes("await reportResult(chatId")) fixed = fixed.replace("await reportResult(", "await reportResult(chatId, ");
  
  out.push(fixed);
}

const result = out.join("\n");
writeFileSync(src, result, "utf-8");
console.log("Built " + out.length + " lines");

// Quick sanity
const hasCHATID = result.match(/\bCHAT_ID\b/g);
const filtered = (hasCHATID || []).filter(m => !result.includes("MONITOR_CHAT_ID") && !result.includes("ANCHOR_CHAT_ID"));
console.log("Remaining bare CHAT_ID: " + (filtered.length || "0"));
