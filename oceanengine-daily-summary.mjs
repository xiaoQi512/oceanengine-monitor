// oceanengine-daily-summary.mjs — 大号日汇报（管理层版）
// 每天下播后触发：HTTP API 拉直播全天 + 短视频全天 → 合并 → 推飞书群
// 推送目标: 上架群
//
// 环境变量：
//   OEC_SILENT=1   静默模式
//   OEC_FORCE=1    强制执行（测试用）
//   OEC_DRY_RUN=1  只采集不推送

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient, getSessionStats } from "./oceanengine-api-client.mjs";
import {
  findLarkCli, DATA_DIR, getLocalDate, getShiftsPerDay,
  SHIFT_SPREADSHEET_TOKEN as SPREADSHEET_TOKEN, SHIFT_SHEET_ID as SHEET_ID,
  FEISHU_ANCHOR_CHAT_ID as SUMMARY_CHAT_ID, ACCOUNT_ID as LIVE_ACCOUNT_ID,
  VIDEO_ACCOUNT_ID,
} from "./monitor-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OEC_FORCE = process.env.OEC_FORCE === "1";
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === "1";

// ====== 配置（从 monitor-utils 导入）======

// ====== 排班读取 ======
function getSessionsForDate(dateStr) {
  try {
    const cacheFile = path.join(DATA_DIR, `shifts-${dateStr}.json`);
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
      if (Array.isArray(cached.shifts) && cached.shifts.length > 0) {
        return cached.shifts.map(s => {
          const m = s.label.match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
          if (m) return { start: m[1] + ":" + m[2], end: m[3] + ":" + m[4], anchorName: s.anchorName || "" };
          return null;
        }).filter(Boolean);
      }
    }
  } catch {}
  return [
    { start: "06:30", end: "08:30", anchorName: "" },
    { start: "08:30", end: "10:30", anchorName: "" },
    { start: "10:30", end: "12:30", anchorName: "" },
    { start: "12:30", end: "14:30", anchorName: "" },
    { start: "14:30", end: "16:30", anchorName: "" },
    { start: "16:30", end: "18:30", anchorName: "" },
    { start: "18:30", end: "20:30", anchorName: "" },
    { start: "20:30", end: "22:30", anchorName: "" },
    { start: "22:30", end: "23:30", anchorName: "" },
  ];
}

const BASE_DATE = new Date(2026, 5, 26);
const BASE_ROW = 200;

function getTodayStartRow() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let row = BASE_ROW;
  const d = new Date(BASE_DATE);
  while (d < today) {
    const dateStr = d.toISOString().slice(0, 10);
    row += getShiftsPerDay(dateStr);
    d.setDate(d.getDate() + 1);
  }
  return row;
}

function log(...args) { console.log(`[daily-summary] ${new Date().toLocaleString()} |`, ...args); }

function todayDateCN() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function getTodayDateStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// ====== 1. HTTP API 拉直播全天数据 ======
async function fetchLiveAllDay() {
  log("--- 拉取直播账户全天数据...");
  const client = await createClient({ useCache: true });
  const todayStr = getTodayDateStr();
  const sessions = getSessionsForDate(todayStr);

  log(`  ${sessions.length} 个班次, 首班 ${sessions[0].start}`);
  let totalConsume = 0, totalLeads = 0;

  for (const session of sessions) {
    const st = todayStr + " " + session.start + ":00";
    const et = todayStr + " " + session.end + ":00";
    const result = await getSessionStats(client, {
      accountId: LIVE_ACCOUNT_ID,
      startTime: st,
      endTime: et,
    });

    const sessionCost = result.total?.cost || 0;
    const sessionLeads = result.total?.leads || 0;
    totalConsume += sessionCost;
    totalLeads += sessionLeads;
    log(`    [${session.start}-${session.end}]: ¥${sessionCost.toFixed(2)} / ${sessionLeads}转化`);
  }

  const cpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : "0.00";
  log(`  ✅ 直播全天: ¥${totalConsume.toFixed(2)} / ${totalLeads}转化 / CPL¥${cpl}`);
  return { totalConsume, totalLeads, cpl };
}

// ====== 2. HTTP API 拉短视频全天数据 ======
async function fetchVideoAllDay() {
  log("▶ 拉取短视频账户全天数据 (HTTP API)...");
  const client = await createClient({ useCache: true });
  const today = getLocalDate();
  const API_BASE = "https://ad.oceanengine.com";

  const body = JSON.stringify({
    DataSetKey: "basic_ad_data",
    Dimensions: ["stat_time_day", "cdp_marketing_goal"],
    EndTime: today + " 23:59:59",
    StartTime: today + " 00:00:00",
    Filters: {
      ConditionRelationshipType: 1,
      Conditions: [
        { Field: "advertiser_id", Operator: 7, Values: [VIDEO_ACCOUNT_ID] },
      ],
    },
    IsDownload: false,
    Metrics: [
      "stat_cost",
      "convert_cnt",
      "conversion_cost",
      "clue_message_count",
      "message_action",
      "form",
    ],
    OrderBy: [{ Field: "stat_time_day", Type: 2 }],
    PageParams: { Limit: 50, Offset: 0 },
  });

  const url = API_BASE + "/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=" + VIDEO_ACCOUNT_ID;

  const resp = await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      timeout: 15000,
      headers: {
        ...client.cookieData.headers,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ _raw: data, _status: res.statusCode }); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });

  const rows = resp?.data?.StatsData?.Rows || [];
  if (rows.length === 0) {
    log("  ⚠ 短视频API无数据返回");
    return { totalConsume: 0, totalLeads: 0, cpl: "0.00" };
  }

  let videoConsume = 0, videoLeads = 0;
  for (const row of rows) {
    const goal = row.Dimensions?.cdp_marketing_goal?.ValueStr || "";
    const m = row.Metrics || {};
    const cost = parseFloat((m.stat_cost?.ValueStr || "0").replace(/,/g, "")) || 0;
    const leads = parseInt((m.convert_cnt?.ValueStr || "0").replace(/,/g, "")) || 0;

    if (goal.includes("短视频") || goal.includes("图文")) {
      videoConsume += cost;
      videoLeads += leads;
    }
  }

  const cpl = videoLeads > 0 ? (videoConsume / videoLeads).toFixed(2) : "0.00";
  log(`  ✅ 短视频全天: ¥${videoConsume.toFixed(2)} / ${videoLeads}转化 / CPL¥${cpl}`);
  return { totalConsume: videoConsume, totalLeads: videoLeads, cpl };
}

// ====== 3. 从飞书表读主播名 ======
function readAnchorNames() {
  log("▶ 读取主播名...");
  const larkCli = findLarkCli();
  if (!larkCli) { log("  ⚠ lark-cli 不可用"); return []; }
  const today = getLocalDate();
  const startRow = getTodayStartRow();
  const count = getShiftsPerDay(today);
  const endRow = startRow + count - 1;
  try {
    const isExe = larkCli.endsWith(".exe");
    const out = execFileSync(
      isExe ? larkCli : "cmd.exe",
      isExe
        ? ["sheets", "+csv-get", "--spreadsheet-token", SPREADSHEET_TOKEN, "--sheet-id", SHEET_ID, "--range", `A${startRow}:C${endRow}`]
        : ["/c", larkCli, "sheets", "+csv-get", "--spreadsheet-token", SPREADSHEET_TOKEN, "--sheet-id", SHEET_ID, "--range", `A${startRow}:C${endRow}`],
      { encoding: "utf-8", timeout: 20000, windowsHide: true, cwd: __dirname }
    );
    const parsed = JSON.parse(out);
    const csv = parsed?.data?.annotated_csv || "";
    const names = [];
    const csvLines = csv.split("\n");
    for (let li = 0; li < csvLines.length; li++) {
      const cols = csvLines[li].split(",");
      if (cols.length >= 3) {
        const name = cols[2]?.trim();
        if (name) names.push(name);
      }
    }
    const seen = new Set();
    const ordered = names.filter(n => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    log("  ✅ 主播: " + ordered.join(" → "));
    return ordered;
  } catch (e) {
    log("  ⚠ 读取主播名失败: " + e.message);
    return [];
  }
}

// ====== 4. 推送飞书群 ======
function pushToLark(text) {
  const larkCli = findLarkCli();
  if (!larkCli) { log("  ⚠ lark-cli 不可用"); return false; }
  const isExe = larkCli.endsWith(".exe");
  try {
    const out = execFileSync(
      isExe ? larkCli : "cmd.exe",
      isExe
        ? ["im", "+messages-send", "--chat-id", SUMMARY_CHAT_ID, "--text", text, "--as", "bot"]
        : ["/c", larkCli, "im", "+messages-send", "--chat-id", SUMMARY_CHAT_ID, "--text", text, "--as", "bot"],
      { encoding: "utf-8", timeout: 20000, windowsHide: true, cwd: __dirname }
    );
    const parsed = JSON.parse(out);
    if (parsed.ok) {
      log(`  ✅ 已推送飞书群: ${parsed.data?.message_id || "ok"}`);
      return true;
    }
    log(`  ❌ 推送失败: ${parsed.error?.message || JSON.stringify(parsed)}`);
    return false;
  } catch (e) {
    log(`  ❌ 推送异常: ${e.message}`);
    return false;
  }
}

// ====== 主流程 ======
async function main() {
  log("🚀 日汇报推送启动");

  const todayMarker = path.join(DATA_DIR, `daily-summary-done-${getLocalDate()}.json`);
  if (!OEC_FORCE && !OEC_DRY_RUN && fs.existsSync(todayMarker)) {
    log("⚠️ 日汇报今日已推送过，跳过");
    return;
  }

  const live = await fetchLiveAllDay();
  const video = await fetchVideoAllDay();
  const anchors = readAnchorNames();

  const totalConsume = live.totalConsume + video.totalConsume;
  const totalLeads = live.totalLeads + video.totalLeads;
  const totalCpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : "0.00";
  const liveCpl = live.totalLeads > 0 ? (live.totalConsume / live.totalLeads).toFixed(2) : "0.00";
  const videoCpl = video.totalLeads > 0 ? (video.totalConsume / video.totalLeads).toFixed(2) : "0.00";

  const fmt = (v) => Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const sessions = getSessionsForDate(getTodayDateStr());
  const firstSession = sessions[0]?.start || "06:30";
  const lastSession = sessions[sessions.length - 1]?.end || "23:30";

  // ====== 模板格式（不可修改） ======
  const msgText = [
    `【极狐区域福利营销中心】 ${todayDateCN()}数据汇总`,
    `${firstSession}-${lastSession} 直播时段数据`,
    `【主播】：${anchors.length > 0 ? anchors.join(" ") : "-"}`,
    `【私信人数】：-`,
    `【线索数】：-`,
    `【投流费用】：${fmt(totalConsume)}元（直播${fmt(live.totalConsume)}元/短视频${fmt(video.totalConsume)}元）`,
    `【线索成本（CPL）】：${totalCpl}元（直播CPL${liveCpl}/短视频CPL${videoCpl}）`,
  ].join("\n");

  log(`📝 推送内容预览:\n${msgText}\n`);

  if (OEC_DRY_RUN) {
    log("🧪 DRY_RUN，不推送");
    return;
  }

  pushToLark(msgText);
  log("🏁 日汇报完成");
  try { fs.writeFileSync(todayMarker, JSON.stringify({ doneAt: new Date().toISOString() })); } catch {}
}

main().catch(e => {
  log("FATAL:", e.message, e.stack);
  process.exit(1);
});
