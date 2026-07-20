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
import https from "node:https";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findLarkCli, DATA_DIR, getLocalDate, AI_REGIONS, FEISHU_ANCHOR_CHAT_ID } from "./monitor-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === "1";
const AI_CHAT_ID = FEISHU_ANCHOR_CHAT_ID; // 上架群
const API_BASE = "https://ad.oceanengine.com";

process.stdout._handle?.setBlocking?.(true);
function log(...args) { console.log(`[ai-regions] ${new Date().toLocaleString()} |`, ...args); }
function fmtMoney(v) { return (Number(v) || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function todayDateCN() { const d = new Date(); return `${d.getMonth() + 1}月${d.getDate()}日`; }

// ====== HTTP 请求 ======
function httpPost(url, body, cookieData, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      timeout: timeoutMs,
      headers: {
        ...cookieData.headers,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
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
    req.write(bodyStr);
    req.end();
  });
}

// ====== Cookie ======
const COOKIE_CACHE_FILE = path.join(DATA_DIR, ".oec-cookies.json");

async function getCookieData() {
  try {
    if (fs.existsSync(COOKIE_CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(COOKIE_CACHE_FILE, "utf-8"));
      if (cached.expireAt > Date.now()) return cached;
    }
  } catch {}
  log("  🔧 Cookie 缓存失效, 通过 CDP 提取...");
  const { createClient } = await import("./oceanengine-api-client.mjs");
  const client = await createClient({ useCache: false });
  return client.cookieData;
}

function buildStatQueryBody(aadvid, dateStr) {
  return {
    DataSetKey: "basic_ad_data",
    Dimensions: ["stat_time_day", "cdp_marketing_goal"],
    EndTime: `${dateStr} 23:59:59`,
    Filters: {
      ConditionRelationshipType: 1,
      Conditions: [{ Field: "advertiser_id", Operator: 7, Values: [aadvid] }],
    },
    IsDownload: false,
    Metrics: ["stat_cost", "convert_cnt", "conversion_cost", "clue_message_count", "message_action", "form"],
    OrderBy: [{ Field: "stat_time_day", Type: 2 }],
    PageParams: { Limit: 50, Offset: 0 },
    StartTime: `${dateStr} 00:00:00`,
  };
}

// ====== 拉取单个区域数据 ======
async function fetchRegion(region) {
  const { name, aadvid } = region;
  const today = getLocalDate();
  log(`▶ [${name}] HTTP API 拉取... aadvid=${aadvid}`);

  let cookieData;
  try { cookieData = await getCookieData(); }
  catch (e) { log(`  ⚠ [${name}] Cookie 获取失败: ${e.message}`); return { name, liveConsume: 0, liveLeads: 0, videoConsume: 0, videoLeads: 0 }; }

  const url = `${API_BASE}/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=${aadvid}`;
  const body = buildStatQueryBody(aadvid, today);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await httpPost(url, body, cookieData, 15000);

      if (resp.code && resp.code !== 0 && resp.code !== 200) {
        if (attempt < 3) {
          log(`  [${name}] 第${attempt}次 code=${resp.code}, 刷新 Cookie 重试...`);
          try { fs.unlinkSync(COOKIE_CACHE_FILE); } catch {}
          cookieData = await getCookieData();
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
      }

      const rows = resp?.data?.StatsData?.Rows || [];
      if (rows.length === 0) {
        log(`  ⚠ [${name}] 无数据`);
        return { name, liveConsume: 0, liveLeads: 0, videoConsume: 0, videoLeads: 0 };
      }

      let liveConsume = 0, liveLeads = 0, videoConsume = 0, videoLeads = 0;
      for (const row of rows) {
        const goal = row.Dimensions?.cdp_marketing_goal?.ValueStr || "";
        const m = row.Metrics || {};
        const cost = parseFloat((m.stat_cost?.ValueStr || "0").replace(/,/g, "")) || 0;
        const leads = parseInt((m.clue_message_count?.ValueStr || "0").replace(/,/g, "")) || 0;
        if (goal.includes("直播")) { liveConsume += cost; liveLeads += leads; }
        else if (goal.includes("短视频") || goal.includes("图文")) { videoConsume += cost; videoLeads += leads; }
      }

      const totalLeads = liveLeads + videoLeads;
      const totalConsume = liveConsume + videoConsume;
      const cpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : "0.00";
      log(`  ✅ [${name}] 直播¥${liveConsume.toFixed(2)}/${liveLeads}线索 + 短视频¥${videoConsume.toFixed(2)}/${videoLeads}线索 = CPL¥${cpl}`);
      return { name, liveConsume, liveLeads, videoConsume, videoLeads };
    } catch (e) {
      log(`  [${name}] 第${attempt}次异常: ${e.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }
  log(`  ❌ [${name}] 3次重试失败`);
  return { name, liveConsume: 0, liveLeads: 0, videoConsume: 0, videoLeads: 0 };
}

// ====== 推送 ======
function pushToLark(text) {
  const larkCli = findLarkCli();
  if (!larkCli) { log("  ⚠ lark-cli 不可用"); return false; }
  const isExe = larkCli.endsWith(".exe");
  try {
    const out = execFileSync(
      isExe ? larkCli : "cmd.exe",
      isExe
        ? ["im", "+messages-send", "--chat-id", AI_CHAT_ID, "--text", text, "--as", "bot"]
        : ["/c", larkCli, "im", "+messages-send", "--chat-id", AI_CHAT_ID, "--text", text, "--as", "bot"],
      { encoding: "utf-8", timeout: 20000, windowsHide: true, cwd: __dirname }
    );
    const parsed = JSON.parse(out);
    if (parsed.ok) { log(`  ✅ 已推送: ${parsed.data?.message_id || "ok"}`); return true; }
    log(`  ❌ 推送失败: ${parsed.error?.message || JSON.stringify(parsed)}`);
    return false;
  } catch (e) { log(`  ❌ 推送异常: ${e.message}`); return false; }
}

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
  const totalLive = results.reduce((s, r) => ({ consume: s.consume + r.liveConsume, leads: s.leads + r.liveLeads }), { consume: 0, leads: 0 });
  const totalVideo = results.reduce((s, r) => ({ consume: s.consume + r.videoConsume, leads: s.leads + r.videoLeads }), { consume: 0, leads: 0 });
  const grandConsume = totalLive.consume + totalVideo.consume;
  const grandLeads = totalLive.leads + totalVideo.leads;
  const grandCpl = grandLeads > 0 ? (grandConsume / grandLeads).toFixed(2) : "0.00";

  // ====== 模板格式（不可修改） ======
  const dateLabel = todayDateCN();
  const lines = [];
  for (const r of results) {
    const totalLeads = r.liveLeads + r.videoLeads;
    const totalConsume = r.liveConsume + r.videoConsume;
    const totalCpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : "0.00";
    const liveCpl = r.liveLeads > 0 ? (r.liveConsume / r.liveLeads).toFixed(2) : "0.00";
    const videoCpl = r.videoLeads > 0 ? (r.videoConsume / r.videoLeads).toFixed(2) : "0.00";

    lines.push(`【极狐${r.name}】 ${dateLabel}数据汇总`);
    lines.push(`【线索数】：${totalLeads}`);
    lines.push(`【投流费用】：${fmtMoney(totalConsume)}元（直播${fmtMoney(r.liveConsume)}元/短视频${fmtMoney(r.videoConsume)}元）`);
    lines.push(`【线索成本（CPL）】：${totalCpl}元（直播CPL${liveCpl}/短视频CPL${videoCpl}）`);
    lines.push("");
  }

  const text = lines.join("\n");
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

main().catch(e => {
  log(`❌ Fatal: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
