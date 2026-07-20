import { readFileSync, writeFileSync } from "fs";
const src = "E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs";
let content = readFileSync(src, "utf-8");

// Fix the duplicated import/code block after main()
// Line 247 has "} from 'url';" followed by duplicate imports
// Find this pattern and remove it
const badEnd = "} from 'url';\r\nimport { spawnSync, spawn } from 'child_process';\r\nimport { pushText } from './feishu-push-guard.mjs';\r\nimport { findLarkCli, loadSuggestionHistory, saveSuggestionHistory, recalcSummary, DATA_DIR, CHROME_USER_DATA_DIR, CHROME_PROFILE_DIRECTORY, findChromeExe } from './monitor-utils.mjs';\r\nimport { checkCDP } from './cdp-client.mjs';\r\n\r\nconst __dirname = path.dirname(fileURLToPath(import.meta.url));\r\n\r\nconst MONITOR_CHAT_ID";

// The correct content should end main() with just "}" and then have the final lines
// Find where main() should end
const mainEnd = content.lastIndexOf("}, 10000);\n}");
// The bad section starts right after main() ends
const afterMain = content.indexOf("\n", mainEnd) + 1;

// Check what's after main
const snippet = content.slice(afterMain, afterMain + 100);
console.log("After main():", JSON.stringify(snippet.slice(0, 80)));

if (snippet.includes("from 'url'")) {
  // There's duplicated code. Find where the real code continues.
  // Look for the SECOND occurrence of "const ACTION_QUEUE"
  const firstActionQueue = content.indexOf("const ACTION_QUEUE");
  const secondActionQueue = content.indexOf("const ACTION_QUEUE", firstActionQueue + 1);
  
  if (secondActionQueue > 0) {
    // Remove everything between afterMain and secondActionQueue
    content = content.slice(0, afterMain) + "\n" + content.slice(secondActionQueue);
    console.log("Removed duplicated block, kept from ACTION_QUEUE onwards");
  } else {
    // Just fix the dangling "} from 'url';" line
    content = content.replace("\n} from 'url';\r\nimport", "\n\n// End of main\n\n// (imports already at top)");
    console.log("Fixed dangling import line");
  }
}

writeFileSync(src, content, "utf-8");
console.log("Cleanup done");
