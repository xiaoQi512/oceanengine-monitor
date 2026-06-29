// patch-v3.js - 用 ensureDataConsistency 替代旧校准逻辑
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join('E:', '炼丹炉', 'WorkBuddy', '2026-06-11-08-56-59', 'oceanengine-monitor-v3.mjs');
let code = fs.readFileSync(FILE, 'utf-8');

// 定位旧校准逻辑的范围
const START = '  // ===== 页面校准（防止搜索框残留/日期错误/状态筛选导致数据不全）=====';
const END   = "  console.log('  ✅ 页面校准完成');";

const iStart = code.indexOf(START);
const iEnd   = code.indexOf(END);

if (iStart === -1 || iEnd === -1) {
  console.error('未找到旧校准逻辑，退出');
  process.exit(1);
}

// END 行末尾是 \n，找到整行结束位置
const iEndLine = code.indexOf('\n', iEnd);
if (iEndLine === -1) {
  console.error('未找到 END 行末尾');
  process.exit(1);
}

const oldBlock = code.substring(iStart, iEndLine + 1);
console.log(`旧校准逻辑: ${iStart}–${iEndLine} (${oldBlock.split('\n').length} 行)`);

const newBlock =
`  // ===== 数据一致性校验：页头消耗 vs 汇总行消耗 =====
  // 不一致时自动校准页面（日期、搜索、状态、排序），最多重试3次
  console.log('  🔬 数据一致性校验...');
  await ensureDataConsistency(client, 3);
  
  // 设置页面大小为50条`;

code = code.substring(0, iStart) + newBlock + code.substring(iEndLine + 1);

fs.writeFileSync(FILE + '.bak', fs.readFileSync(FILE));  // 备份
fs.writeFileSync(FILE, code, 'utf-8');
console.log('✅ 替换完成，原文件已备份为 .bak');
