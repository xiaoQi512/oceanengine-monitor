// send-chat.mjs — Codex回复飞书群消息
// 用法: node send-chat.mjs <chatId> "消息文本"
// 示例: node send-chat.mjs oc_8deeb3061bdbd43608de252a44c97a25 "你好，已处理"
import { pushText } from "./feishu-push-guard.mjs";
import { findLarkCli } from "./monitor-utils.mjs";

const chatId = process.argv[2];
const text = process.argv[3];

if (!chatId || !text) {
  console.error("用法: node send-chat.mjs <chatId> <text>");
  process.exit(1);
}

const larkCli = findLarkCli() || "lark-cli";
const r = await pushText(larkCli, text, chatId, {
  timeoutMs: 15000, maxRetries: 1,
  circuitFailureThreshold: 2, circuitFailureWindow: 4,
  circuitOpenDurationMs: 60_000,
});
if (r.ok) { console.log("OK"); process.exit(0); }
else { console.error("FAIL:", r.error); process.exit(1); }
