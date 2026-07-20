import { spawnSync } from "child_process";
import { findLarkCli } from "./monitor-utils.mjs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const larkCli = findLarkCli();
console.log("lark-cli:", larkCli);

const CHATS = [
  { id: "oc_8deeb3061bdbd43608de252a44c97a25", name: "Monitor群" },
  { id: "oc_b245ee4b255c7b25b7f8d953802c49ff", name: "上架群" }
];

for (const chat of CHATS) {
  console.log(`\n=== ${chat.name}: ${chat.id} ===`);
  try {
    const isExe = larkCli.endsWith(".exe");
    const args = isExe
      ? ["im", "+chat-messages-list", "--chat-id", chat.id, "--page-size", "5", "--sort", "desc"]
      : ["/c", larkCli, "im", "+chat-messages-list", "--chat-id", chat.id, "--page-size", "5", "--sort", "desc"];
    const exe = isExe ? larkCli : "cmd.exe";
    
    const r = spawnSync(exe, args, {
      encoding: "utf8", timeout: 10000, windowsHide: true, cwd: __dirname
    });
    const out = (r.stdout || "").trim();
    if (!out) { console.log("  (empty stdout)"); continue; }
    const d = JSON.parse(out);
    if (!d.ok) { console.log("  Error:", JSON.stringify(d.error)); continue; }
    const msgs = d.data?.messages || [];
    console.log(`  ${msgs.length} messages:`);
    for (const m of msgs.slice(0, 3)) {
      const content = JSON.parse(m.content || "{}");
      const text = (content.text || "").slice(0, 100);
      console.log(`  [${m.message_id.slice(-8)}] ${m.sender?.name || "?"}: ${text}`);
    }
  } catch (e) {
    console.log("  Error:", e.message);
  }
}
