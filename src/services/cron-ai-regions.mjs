// ai-regions-http.mjs — AI区域号每日汇报
// 21:30 触发：HTTP API 直拉 5 个 AI 账户全天数据 → 区分直播/短视频 → 合并 → 推飞书群
// 推送目标: 上架群
//
// 环境变量:
//   OEC_SILENT=1   静默模式
//   OEC_FORCE=1    强制执行
//   OEC_DRY_RUN=1  只采集不推送

import fs from "node:fs";
import path from "node:path";
import {
  DATA_DIR, getLocalDate, AI_REGIONS,
} from "../utils/monitor-utils.mjs";
import { runMonitorCli } from "./monitor-cli.mjs";
import { fetchRegion, pushToLark, todayDateCN, summarizeAiRegions, buildAiRegionsReport } from "./ai-regions-core.mjs";
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === "1";

process.stdout._handle?.setBlocking?.(true);
function log(...args) { console.log(`[ai-regions] ${new Date().toLocaleString()} |`, ...args); }


// ====== 主流程 ======
async function main() {
  log("═══════════════════════════════════════");
  log(`  AI区域号每日汇报 | ${todayDateCN()} | ${AI_REGIONS.length} 个区域`);
  log("═══════════════════════════════════════\n");

  const results = [];
  for (const region of AI_REGIONS) {
    const r = await fetchRegion(region);
    results.push(r);
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  // 汇总
  const totals = summarizeAiRegions(results);
  const { totalLive, totalVideo, grandConsume, grandLeads, grandCpl } = totals;
  const text = buildAiRegionsReport({ results, dateLabel: todayDateCN() });
  log(`推送预览:\n${text}\n`);

  if (OEC_DRY_RUN) {
    log("🧪 DRY_RUN，不推送");
  } else {
    pushToLark(text);
  }

  // 保存到 monitor-data
  const reportFile = path.join(DATA_DIR, `ai-regions-${getLocalDate()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify({
    date: getLocalDate(),
    capturedAt: new Date().toISOString(),
    source: "http-api",
    regions: results,
    totals: { live: totalLive, video: totalVideo, grand: { consume: grandConsume, leads: grandLeads }, cpl: parseFloat(grandCpl) },
  }, null, 2));
  log(`📁 报告已保存: ${reportFile}`);
}

export function runCli() {
  runMonitorCli({ run: main });
}
