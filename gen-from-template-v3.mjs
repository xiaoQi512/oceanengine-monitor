// gen-from-template-v3.mjs
// 6.1-6.26 主播放盘点 → 复盘涵盖"整体效果"+"本周突出变化"
// v3.1: fix — 所有shape唯一ID + 全体字号提大
import JSZip from "jszip";
import fs from "fs";
import { execSync } from "child_process";

const tpl = "C:/Users/HTF2026/Desktop/极狐汇报底版.pptx";
const out = "E:/炼丹炉/WorkBuddy/巨量引擎监控/【6.20-6.26】极狐区域号周度汇报.pptx";
const tmp = "E:/炼丹炉/WorkBuddy/巨量引擎监控/.tmp-anchor-ppt.pptx";

// === 拉取6.1-6.26全月数据 ===
console.log("→ 拉取6.1-6.26主播班次数据...");
const csvRaw = execSync(
  `lark-cli sheets +csv-get --token WbGuwV3MQi2HX8k5BnLcpXR0nTd --sheet-id j69tpS --range "A1:I5000"`,
  { encoding: "utf8" }
);
const csvData = JSON.parse(csvRaw);
const csv = csvData.data.annotated_csv;

const lines = csv.split("\n").filter(l => l.trim() && !l.startsWith("[row=1]"));
const rows = lines.slice(1).map(line => {
  const parts = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (c === ',' && !inQuote) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  return {
    date: parts[0]?.trim(),
    slot: parts[1]?.trim(),
    name: parts[2]?.trim(),
    spend: parseFloat((parts[3] || "0").replace(/,/g, "")) || 0,
    lead:  parseInt(parts[4] || "0") || 0,
    cpl:   parseFloat(parts[5] || "0") || 0,
  };
});

console.log(`✓ 原始行数: ${rows.length}`);

// === 过滤 6.1-6.26 ===
function dateInRange(dateStr) {
  if (!dateStr) return false;
  const m = dateStr.match(/(\d+)月(\d+)日/);
  if (!m) return false;
  const d = parseInt(m[2]);
  return d >= 1 && d <= 26;
}
const filtered = rows.filter(r => dateInRange(r.date));
console.log(`✓ 6.1-6.26行数: ${filtered.length}`);

// === 整体 (6.1-6.26) ===
const overall = {};
filtered.forEach(r => {
  if (!overall[r.name]) overall[r.name] = { slot: 0, spend: 0, lead: 0 };
  overall[r.name].slot += 1;
  overall[r.name].spend += r.spend;
  overall[r.name].lead  += r.lead;
});

// === 本周 (6.20-6.26) ===
const thisWeek = filtered.filter(r => {
  const m = r.date.match(/(\d+)月(\d+)日/);
  return m && parseInt(m[2]) >= 20;
});

// === 上周 (6.13-6.19) ===
const lastWeek = filtered.filter(r => {
  const m = r.date.match(/(\d+)月(\d+)日/);
  const d = m ? parseInt(m[2]) : 0;
  return d >= 13 && d <= 19;
});

function aggregate(arr) {
  const m = {};
  arr.forEach(r => {
    if (!m[r.name]) m[r.name] = { slot: 0, spend: 0, lead: 0 };
    m[r.name].slot += 1;
    m[r.name].spend += r.spend;
    m[r.name].lead  += r.lead;
  });
  return m;
}
const wk = aggregate(thisWeek);
const lw = aggregate(lastWeek);

// === 主播行 (按整体消耗降序) ===
const order = Object.entries(overall)
  .map(([name, v]) => ({ name, ...v, cpl: v.spend / v.lead }))
  .sort((a, b) => b.spend - a.spend);

const TIERS = {
  "张萌": { tier: "S",  color: "FF6B35" },
  "芝芝": { tier: "A+", color: "2E8B57" },
  "三水": { tier: "A",  color: "4698CB" },
  "小雪": { tier: "B+", color: "F39C12" },
  "小明": { tier: "B",  color: "5A6B7E" },
  "薇薇": { tier: "—",  color: "5A6B7E" },
  "小黄": { tier: "—",  color: "5A6B7E" },
};

const anchorRows = order.map(a => {
  const last = lw[a.name];
  const thisW = wk[a.name];
  let chg = "—", chgC = "5A6B7E";
  if (thisW && last && last.cpl > 0) {
    const diff = (thisW.cpl - last.cpl) / last.cpl * 100;
    chg = (diff > 0 ? "+" : "") + diff.toFixed(0) + "%";
    chgC = diff > 5 ? "C0392B" : diff < -5 ? "2E8B57" : "5A6B7E";
  } else if (thisW && !last) {
    chg = "新增";
    chgC = "4698CB";
  } else if (!thisW) {
    chg = "未出勤";
    chgC = "5A6B7E";
  }
  return {
    name: a.name, slot: a.slot, hour: a.slot * 2,
    spend: a.spend, lead: a.lead, cpl: a.cpl, cplW: thisW ? thisW.cpl : null,
    chg, chgC,
    tier: TIERS[a.name]?.tier || "—",
    tierC: TIERS[a.name]?.color || "5A6B7E",
  };
});

const totalSpend = anchorRows.reduce((s, r) => s + r.spend, 0);
const totalLead  = anchorRows.reduce((s, r) => s + r.lead, 0);
const totalSlot  = anchorRows.reduce((s, r) => s + r.slot, 0);
const totalCPL   = totalSpend / totalLead;

console.log("=== 6.1-6.26 主播汇总(降序) ===");
anchorRows.forEach(r => console.log(`  ${r.tier.padEnd(2)} ${r.name} 班次${r.slot} 时长${r.hour}h 消耗¥${r.spend.toFixed(0)} 线索${r.lead} CPL¥${r.cpl.toFixed(1)} 本周${r.chg}`));
console.log(`合计: ${totalSlot}班次 消耗¥${totalSpend.toFixed(0)} 线索${totalLead} CPL¥${totalCPL.toFixed(1)}`);

// === 复制底版 ===
fs.copyFileSync(tpl, tmp);
const data = fs.readFileSync(tmp);
const zip = await JSZip.loadAsync(data);
let slide1 = await zip.file("ppt/slides/slide1.xml").async("string");

// 标题改为 6.1-6.26
slide1 = slide1.replace(/<a:t>6\.1[\s\S]*?6\.26<\/a:t>/, "<a:t>6.1-6.26</a:t>");
slide1 = slide1.replace(/<a:t>6\.1<\/a:t>/, "<a:t>6.1-6.26</a:t>");

// 配色
const C = {
  panelFill: "F5F8FC", panelLine: "BFD3E6", rowAlt: "E8F0F7",
  headerBg: "4698CB", accent: "FF6B35", text: "1F2A3A", textSub: "5A6B7E",
  green: "2E8B57", yellow: "F39C12", red: "C0392B",
  totalBg: "FF6B35", highlightBg: "FFF3E0",
};

// === 唯一ID计数器 ===
let sid = 100;
const nextId = () => ++sid;
const nameId = (tag) => `s${nextId()}_${tag}`;

const rPr = (sz, bold, color) =>
  `<a:rPr lang="zh-CN" altLang="en-US" dirty="0" sz="${sz}" b="${bold ? 1 : 0}">` +
  `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` +
  `<a:latin typeface="微软雅黑" panose="020B0503020204020204" charset="-122"/>` +
  `<a:ea typeface="微软雅黑" panose="020B0503020204020204" charset="-122"/>` +
  `</a:rPr>`;

const cellText = (x, y, cx, cy, sz, bold, color, text, align = "center") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${nextId()}" name="txt"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
  `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/>` +
  `<a:lstStyle/><a:p><a:pPr marL="0" marR="0" indent="0" algn="${align}"/><a:r>${rPr(sz, bold, color)}` +
  `<a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;

const rect = (x, y, cx, cy, fill, line) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${nextId()}" name="rect"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
  `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` +
  (line ? `<a:ln w="6350"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln>` : `<a:ln><a:noFill/></a:ln>`) +
  `</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`;

let shapes = "";

// === KPI 4 卡 (字号: label 14pt / value 28pt / sub 12pt) ===
const kpiY = 900000, kpiH = 800000, kpiW = 2900000, gap = 120000, kpiX0 = 200000;
const kpis = [
  { label: "6.1-6.26总消耗", value: "¥" + (totalSpend/10000).toFixed(1) + "万", sub: `日均 ¥${(totalSpend/26/10000).toFixed(2)}万`, color: C.accent },
  { label: "总线索量",       value: totalLead.toLocaleString("zh-CN"),  sub: `CPL ¥${totalCPL.toFixed(0)}`,   color: C.green },
  { label: "班次/时长",       value: totalSlot.toString(),   sub: `总时长 ${totalSlot*2}h`,         color: C.headerBg },
  { label: "最高消耗/H",     value: "¥" + Math.max(...anchorRows.map(r => r.spend/r.hour)).toFixed(0), sub: anchorRows.reduce((a,b)=> a.spend/a.hour>b.spend/b.hour?a:b).name, color: C.yellow },
];
kpis.forEach((k, i) => {
  const x = kpiX0 + i * (kpiW + gap);
  shapes += rect(x, kpiY, kpiW, kpiH, C.panelFill, C.panelLine);
  shapes += rect(x, kpiY, 50000, kpiH, k.color, k.color);
  shapes += cellText(x + 80000, kpiY + 50000, kpiW - 100000, 180000, 140, false, C.textSub, k.label, "left");
  shapes += cellText(x + 80000, kpiY + 220000, kpiW - 100000, 350000, 280, true, k.color, k.value, "left");
  shapes += cellText(x + 80000, kpiY + 580000, kpiW - 100000, 180000, 120, false, C.textSub, k.sub, "left");
});

// === 主播表 (字号: header 13pt / body 12pt / CPL 14pt / position 12pt) ===
const tx0 = 200000, ty0 = 1850000, tw = 7000000, th = 3700000;
shapes += rect(tx0, ty0, tw, th, C.panelFill, C.panelLine);

const headerH = 320000;
shapes += rect(tx0, ty0, tw, headerH, C.headerBg, C.headerBg);
const colX = [100000, 350000, 1100000, 1800000, 2500000, 3700000, 4500000, 5300000, 6100000];
const colWArr = [240000, 720000, 680000, 680000, 1180000, 780000, 780000, 780000, 880000];
const headers = ["梯队", "主播", "班次", "时长", "消耗(元)", "线索", "CPL(¥)", "CPL变化", "整体定位"];
colX.forEach((x, i) => {
  shapes += cellText(x, ty0 + 10000, colWArr[i], headerH - 20000, 130, true, "FFFFFF", headers[i]);
});

const POSITION = {
  "张萌": "全队第一 量价双优",
  "芝芝": "本周最大黑马",
  "三水": "出勤最高 质效稳",
  "小雪": "暴力放量 CPL偏高",
  "小明": "稳定轮换主力",
  "薇薇": "首秀亮眼 待观察",
  "小黄": "样本少 性价比待验",
};
const rowsWithChg = anchorRows.map(r => {
  const lwCpl = lw[r.name]?.cpl;
  const twCpl = wk[r.name]?.cpl;
  let chg = "—", chgC = "5A6B7E";
  if (twCpl && lwCpl) {
    const diff = (twCpl - lwCpl) / lwCpl * 100;
    chg = (diff > 0 ? "+" : "") + diff.toFixed(0) + "%";
    chgC = diff > 5 ? "C0392B" : diff < -5 ? "2E8B57" : "5A6B7E";
  } else if (twCpl && !lwCpl) {
    chg = "新增"; chgC = "4698CB";
  } else if (lwCpl && !twCpl) {
    chg = "本周缺席"; chgC = "5A6B7E";
  }
  return { ...r, chg, chgC };
});

const rowH = 380000;
rowsWithChg.forEach((r, i) => {
  const ry = ty0 + headerH + i * rowH;
  if (r.chgC === C.red || r.chgC === C.green) {
    shapes += rect(tx0 + 50000, ry + 10000, tw - 100000, rowH - 20000, C.highlightBg, null);
  } else if (i % 2 === 0) {
    shapes += rect(tx0 + 50000, ry + 10000, tw - 100000, rowH - 20000, C.rowAlt, null);
  }
  const tierX = colX[0], tierY = ry + 80000;
  const tierSz = r.tier.length > 1 ? 100 : 130;  // "A+" 小一点
  shapes += rect(tierX, tierY, 200000, 200000, r.tierC, r.tierC);
  shapes += cellText(tierX, tierY, 200000, 200000, tierSz, true, "FFFFFF", r.tier);
  shapes += cellText(colX[1], ry, colWArr[1], rowH, 120, true, C.text, r.name, "left");
  shapes += cellText(colX[2], ry, colWArr[2], rowH, 120, false, C.text, r.slot.toString());
  shapes += cellText(colX[3], ry, colWArr[3], rowH, 120, false, C.text, r.hour + "h");
  shapes += cellText(colX[4], ry, colWArr[4], rowH, 120, false, C.text, "¥" + r.spend.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
  shapes += cellText(colX[5], ry, colWArr[5], rowH, 120, false, C.text, r.lead.toLocaleString("zh-CN"));
  shapes += cellText(colX[6], ry, colWArr[6], rowH, 140, true, r.cpl <= 90 ? C.green : r.cpl <= 100 ? C.yellow : C.red, "¥" + r.cpl.toFixed(0));
  shapes += cellText(colX[7], ry, colWArr[7], rowH, 120, true, r.chgC, r.chg);
  shapes += cellText(colX[8], ry, colWArr[8], rowH, 110, false, C.textSub, POSITION[r.name] || "—", "left");
});

const totalY = ty0 + headerH + rowsWithChg.length * rowH + 30000;
shapes += rect(tx0 + 50000, totalY, tw - 100000, 350000, C.totalBg, C.totalBg);
const tcol = [
  { txt: "合计" }, { txt: "—" }, { txt: totalSlot.toString() }, { txt: (totalSlot*2) + "h" },
  { txt: "¥" + totalSpend.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",") },
  { txt: totalLead.toLocaleString("zh-CN") },
  { txt: "¥" + totalCPL.toFixed(0) },
  { txt: "—" },
  { txt: "整体水位" },
];
tcol.forEach((t, i) => {
  shapes += cellText(colX[i], totalY, colWArr[i], 350000, 130, true, "FFFFFF", t.txt, i === 8 ? "left" : "center");
});

// === 右侧 图表区 (字号: title 14pt / bar label 12pt) ===
const cx0 = 7400000, cy0 = 1850000, cw = 4580000, ch = 1900000;
shapes += rect(cx0, cy0, cw, ch, C.panelFill, C.panelLine);
shapes += cellText(cx0 + 100000, cy0 + 20000, cw - 200000, 240000, 140, true, C.accent, "📈 整体消耗 vs CPL(6.1-6.26)");

const cInnerX = cx0 + 200000, cInnerY = cy0 + 320000, cInnerW = cw - 400000, cInnerH = ch - 500000;
const maxV = Math.max(...rowsWithChg.map(r => r.spend / 1000));
const barH = (cInnerH - 100000) / rowsWithChg.length;
rowsWithChg.forEach((r, i) => {
  const by = cInnerY + i * barH;
  const w = Math.round((r.spend / 1000 / maxV) * (cInnerW - 900000));
  shapes += cellText(cInnerX, by + 20000, 350000, barH - 40000, 110, true, C.text, r.name, "left");
  shapes += rect(cInnerX + 380000, by + 40000, Math.max(w, 20000), barH - 80000, r.cpl <= 90 ? C.green : r.cpl <= 100 ? C.yellow : C.red, null);
  shapes += cellText(cInnerX + 380000 + w + 30000, by + 30000, 600000, barH - 60000, 110, true, C.text, "¥" + (r.spend / 1000).toFixed(1) + "k", "left");
});

// === 右侧 洞察区 (字号: title 14pt / tag 13pt / text 12pt) ===
const ix0 = 7400000, iy0 = 3850000, iw = 4580000, ih = 1700000;
shapes += rect(ix0, iy0, iw, ih, C.panelFill, C.panelLine);
shapes += cellText(ix0 + 100000, iy0 + 20000, iw - 200000, 240000, 140, true, C.accent, "🎯 复盘: 整体效果 & 本周变化");

const insights = [
  { tag: "📊 整体", text: `6.1-6.26日均¥${(totalSpend/26/10000).toFixed(2)}万 CPL¥${totalCPL.toFixed(0)} 张萌/芝芝贡献主力`, color: C.headerBg },
  { tag: "🏆 亮点", text: "芝芝量效双升: CPL -11%/消耗 +14% 本周最大黑马", color: C.green },
  { tag: "⚠️ 风险", text: "小雪放量+46% 但 CPL 同步走高至¥108", color: C.yellow },
  { tag: "🔍 观察", text: "薇薇首秀 ¥3791/H + CPL ¥99 待观察", color: C.accent },
];
insights.forEach((ins, i) => {
  const y = iy0 + 280000 + i * 320000;
  shapes += rect(ix0 + 120000, y + 15000, 850000, 260000, ins.color, ins.color);
  shapes += cellText(ix0 + 120000, y + 15000, 850000, 260000, 130, true, "FFFFFF", ins.tag, "center");
  shapes += cellText(ix0 + 1020000, y, iw - 1080000, 290000, 120, false, C.text, ins.text, "left");
});

// === Footer (字号 11pt) ===
shapes += cellText(200000, 6600000, 11800000, 200000, 110, false, C.textSub,
  "数据源: 飞书 6月主播班次表(j69tpS)  |  生成时间: 2026-06-27  |  爆量君", "left");

slide1 = slide1.replace("</p:spTree>", shapes + "</p:spTree>");

zip.file("ppt/slides/slide1.xml", slide1);
const newBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
fs.writeFileSync(tmp, newBuf);
try { fs.unlinkSync(out); } catch (e) {}
fs.copyFileSync(tmp, out);
fs.unlinkSync(tmp);
console.log("✅ 已生成:", out);
