import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, "feishu-listener.mjs");
let content = readFileSync(src, "utf-8");

// ====== 1. 修改注释 ======
content = content.replace(
  "// feishu-listener.mjs 鈥?椋炰功缇ゆ秷鎭洃鍚?+ 涓夐樁娈靛弽棣堥棴鐜?,
  "// feishu-listener.mjs 鈥?鍙岀兢娑堟伅鐩戝惉 + 涓夐樁娈靛弽棣堥棴鐜?+ @鍥炲"
);
content = content.replace(
  "// 杞妯″紡锛氭瘡 10 绉掓媺鍙栨渶鏂扮兢娑堟伅锛岃В鏋愭寚浠ゅ悗鎸変笁闃舵鎵ц锛?,
  "// 杞妯″紡锛氭瘡 10 绉掑悓鏃舵媺鍙?Monitor缇?+ 涓婃灦缇?鏈€鏂版秷鎭紝瑙ｆ瀽鎸囦护鎴?@鎻愬強鍚庡洖澶?"
);

writeFileSync(src, content, "utf-8");
console.log("Step 1 done");
