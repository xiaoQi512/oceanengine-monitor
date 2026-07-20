// sync-tomorrow-shifts.mjs — 每日同步次日主播排班到本地缓存
// PM2 cron: 0 23 * * *（每天23:00执行）
// 读取飞书排班表次日班次，写入 monitor-data/shifts-YYYY-MM-DD.json
// 供 getTodayShiftWindow() / readTodayShifts() / readTodayShiftTimes() 优先读取

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "monitor-data");

// ====== 配置 ======
const SPREADSHEET_TOKEN = "GiNOslsWQhyHDPtclPscns3GnAf";
const SHEET_ID = "j69tpS";
const BASE_DATE = new Date(2026, 5, 26); // 2026-06-26
const BASE_ROW = 200;

// ====== lark-cli 查找 ======
function findLarkCli() {
  const home = process.env.HOME || process.env.USERPROFILE || "C:/Users/HTF2026";
  const larkPkgDir = path.join(home, ".workbuddy/binaries/node/cli-connector-packages");
  const candidates = [
    path.join(larkPkgDir, "node_modules/@larksuite/cli/bin/lark-cli.exe"),
    path.join(larkPkgDir, "lark-cli.cmd"),
    path.join(larkPkgDir, "lark-cli"),
    "lark-cli",
    "lark-cli.cmd",
  ];
  for (const c of candidates) {
    try {
      if (c.endsWith(".exe")) {
        if (!fs.existsSync(c)) continue;
      }
      return c;
    } catch {}
  }
  return "";
}

// ====== 日期工具 ======
function getLocalDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getTomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return getLocalDate(d);
}

// ====== 排班表行号计算 ======
function getShiftsPerDay(dateStr) {
  if (dateStr >= "2026-07-08" && dateStr <= "2026-07-10") return 9;
  return 8;
}

function getShiftRowForDate(dateStr) {
  const target = new Date(dateStr + "T00:00:00+08:00");
  let row = BASE_ROW;
  const d = new Date(BASE_DATE);
  while (d < target) {
    row += getShiftsPerDay(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return row;
}

// ====== 从飞书读取排班 ======
function fetchShifts(dateStr) {
  const larkCli = findLarkCli();
  if (!larkCli) throw new Error("lark-cli not found");

  const startRow = getShiftRowForDate(dateStr);
  const count = getShiftsPerDay(dateStr);
  const endRow = startRow + count - 1;

  const isExe = larkCli.endsWith(".exe");

  // 同时读取 B 列（时间）和 C 列（主播名）
  const range = `B${startRow}:C${endRow}`;
  const out = execFileSync(
    isExe ? larkCli : "cmd.exe",
    isExe
      ? ["sheets", "+csv-get", "--spreadsheet-token", SPREADSHEET_TOKEN, "--sheet-id", SHEET_ID, "--range", range]
      : ["/c", larkCli, "sheets", "+csv-get", "--spreadsheet-token", SPREADSHEET_TOKEN, "--sheet-id", SHEET_ID, "--range", range],
    { encoding: "utf-8", timeout: 20000, windowsHide: true, cwd: __dirname }
  );

  const parsed = JSON.parse(out);
  const csv = parsed?.data?.annotated_csv || "";
  const lines = csv.split("\n").filter(l => l.trim());

  if (lines.length === 0) throw new Error("排班表为空");

  const shifts = [];
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const timeCell = (cols[0] || "").trim();
    const anchorCell = (cols[1] || "").trim();

    const match = timeCell.match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
    if (match) {
      const startTime = match[1] + ":" + match[2];
      const endTime = match[3] + ":" + match[4];
      const [startH, startM] = [parseInt(match[1]), parseInt(match[2])];
      const [endH, endM] = [parseInt(match[3]), parseInt(match[4])];

      const hours = [];
      for (let h = startH; h <= endH; h++) {
        if (h === endH && endM === 0) continue;
        hours.push(h);
      }

      shifts.push({
        label: `${startTime}-${endTime}`,
        hours,
        row: startRow + i,
        anchorName: anchorCell || "",
      });
    }
  }

  if (shifts.length === 0) throw new Error("无法解析班次时间");

  // 找最早开始和最晚结束（而非首尾行，因为可能有跨天班次）
  let minStartH = 24, minStartM = 0, maxEndH = 0, maxEndM = 0;
  let earliestStart = "", latestEnd = "";
  for (const s of shifts) {
    const [sh, sm] = s.label.split("-")[0].split(":").map(Number);
    const [eh, em] = s.label.split("-")[1].split(":").map(Number);
    if (sh < minStartH || (sh === minStartH && sm < minStartM)) {
      minStartH = sh; minStartM = sm; earliestStart = s.label.split("-")[0];
    }
    if (eh > maxEndH || (eh === maxEndH && em > maxEndM)) {
      maxEndH = eh; maxEndM = em; latestEnd = s.label.split("-")[1];
    }
  }
  const firstStartH = minStartH, firstStartM = minStartM;
  const lastEndH = maxEndH, lastEndM = maxEndM;

  return {
    date: dateStr,
    startHour: firstStartH,
    startMinute: firstStartM,
    endHour: lastEndH,
    endMinute: lastEndM,
    startTime: earliestStart,
    endTime: latestEnd,
    shifts,
    syncedAt: new Date().toISOString(),
  };
}

// ====== 写入缓存 ======
function saveCache(dateStr, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const cacheFile = path.join(DATA_DIR, `shifts-${dateStr}.json`);
  const tmpFile = cacheFile + ".tmp";
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpFile, cacheFile);
    return true;
  } catch {
    try { fs.unlinkSync(tmpFile); } catch {}
    return false;
  }
}

// ====== 主流程 ======
async function main() {
  console.log(`[sync-tomorrow] ${new Date().toLocaleString()} | 开始同步次日排班...`);

  const tomorrow = getTomorrowDate();
  console.log(`[sync-tomorrow] 目标日期: ${tomorrow}`);

  try {
    const data = fetchShifts(tomorrow);
    const ok = saveCache(tomorrow, data);
    if (ok) {
      console.log(`[sync-tomorrow] ✅ 同步成功: ${data.startTime}-${data.endTime} (${data.shifts.length}个班次)`);
      console.log(`[sync-tomorrow]    缓存: monitor-data/shifts-${tomorrow}.json`);
      for (const s of data.shifts) {
        console.log(`[sync-tomorrow]    ${s.label} -> ${s.anchorName || "(无主播名)"}`);
      }
    } else {
      console.error(`[sync-tomorrow] ❌ 缓存写入失败`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`[sync-tomorrow] ❌ 同步失败: ${e.message}`);
    process.exit(1);
  }
}

main();
