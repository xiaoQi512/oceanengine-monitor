// gen-from-template.mjs
// 复制底版 pptx → 直接修改 slide1.xml → 保留母版/版式/主题色/背景图
import JSZip from "jszip";
import fs from "fs";

const tpl = "C:/Users/HTF2026/Desktop/极狐汇报底版.pptx";
const out = "E:/炼丹炉/WorkBuddy/巨量引擎监控/极狐汇报_主播复试_6月20-26日.pptx";

fs.copyFileSync(tpl, out);
console.log("✓ 已复制底版");

const data = fs.readFileSync(out);
const zip = await JSZip.loadAsync(data);

let slide1 = await zip.file("ppt/slides/slide1.xml").async("string");

// === 1. 改标题文字 6.1 → 6.20 ===
slide1 = slide1.replace("<a:t>6.1</a:t>", "<a:t>6.20</a:t>");
console.log("✓ 标题已改为 6.20-6.26");

// === 2. 构造 shape 字符串 ===

// 配色（与母版蓝 4698CB 协调；底版是浅色图片底，所以面板用浅白）
const C = {
  panelFill:   "F5F8FC",
  panelLine:   "BFD3E6",
  rowAlt:      "E8F0F7",
  headerBg:    "4698CB",
  accent:      "FF6B35",
  text:        "1F2A3A",
  textSub:     "5A6B7E",
  green:       "2E8B57",
  yellow:      "F39C12",
  red:         "C0392B",
  totalBg:     "FF6B35",
};

const rPr = (sz, bold, color) =>
  `<a:rPr lang="zh-CN" altLang="en-US" dirty="0" sz="${sz}" b="${bold ? 1 : 0}">` +
  `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` +
  `<a:latin typeface="微软雅黑" panose="020B0503020204020204" charset="-122"/>` +
  `<a:ea typeface="微软雅黑" panose="020B0503020204020204" charset="-122"/>` +
  `</a:rPr>`;

const cellText = (x, y, cx, cy, sz, bold, color, text, align = "center") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="0" name="txt"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
  `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/>` +
  `<a:lstStyle/><a:p><a:pPr algn="${align}"/><a:r>${rPr(sz, bold, color)}` +
  `<a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;

const rect = (x, y, cx, cy, fill, line) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="0" name="rect"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
  `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` +
  (line ? `<a:ln w="6350"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln>` : `<a:ln><a:noFill/></a:ln>`) +
  `</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`;

let shapes = "";

// === KPI 4 卡 ===
const kpiY = 900000, kpiH = 800000, kpiW = 2900000, gap = 120000, kpiX0 = 200000;
const kpis = [
  { label: "本周总消耗",  value: "¥27.95万", sub: "日均 ¥3.99万",  color: C.accent },
  { label: "总线索量",    value: "2958",     sub: "CPL ¥95",        color: C.green },
  { label: "班次",        value: "55",       sub: "总时长 110h",    color: C.headerBg },
  { label: "最高消耗/H",  value: "¥3331",    sub: "小雪(晚高峰)",   color: C.yellow },
];
kpis.forEach((k, i) => {
  const x = kpiX0 + i * (kpiW + gap);
  shapes += rect(x, kpiY, kpiW, kpiH, C.panelFill, C.panelLine);
  shapes += rect(x, kpiY, 50000, kpiH, k.color, k.color);
  shapes += cellText(x + 80000, kpiY + 50000, kpiW - 100000, 180000, 110, false, C.textSub, k.label, "left");
  shapes += cellText(x + 80000, kpiY + 220000, kpiW - 100000, 350000, 240, true, k.color, k.value, "left");
  shapes += cellText(x + 80000, kpiY + 580000, kpiW - 100000, 180000, 100, false, C.textSub, k.sub, "left");
});

// === 主播表 ===
const tx0 = 200000, ty0 = 1850000, tw = 7000000, th = 3700000;
shapes += rect(tx0, ty0, tw, th, C.panelFill, C.panelLine);

const headerH = 320000;
shapes += rect(tx0, ty0, tw, headerH, C.headerBg, C.headerBg);
const colX = [100000, 350000, 1100000, 1800000, 2500000, 3700000, 4500000, 5300000, 6100000];
const colWArr = [240000, 720000, 680000, 680000, 1180000, 780000, 780000, 780000, 880000];
const headers = ["梯队", "主播", "班次", "时长", "消耗(元)", "线索", "CPL(¥)", "CPL变化", "评价"];
colX.forEach((x, i) => {
  shapes += cellText(x, ty0 + 10000, colWArr[i], headerH - 20000, 110, true, "FFFFFF", headers[i]);
});

const rows = [
  { tier: "S",  name: "张萌", slot: 15, hour: 30, spend: 75300, lead: 856, cpl: 88,  chg: "稳定", note: "全队第一 量价双优", tierC: C.accent,   cplC: C.green,  chgC: C.textSub },
  { tier: "A+", name: "芝芝", slot: 12, hour: 24, spend: 52500, lead: 587, cpl: 89,  chg: "-11%", note: "本周最大黑马",   tierC: C.green,    cplC: C.green,  chgC: C.green  },
  { tier: "B+", name: "小雪", slot: 8,  hour: 16, spend: 53300, lead: 493, cpl: 108, chg: "+5%",  note: "暴力放量 CPL偏高", tierC: C.yellow,   cplC: C.red,    chgC: C.red    },
  { tier: "A",  name: "三水", slot: 10, hour: 20, spend: 43800, lead: 480, cpl: 91,  chg: "+2%",  note: "出勤减 质效持平", tierC: C.headerBg, cplC: C.green,  chgC: C.red    },
  { tier: "B",  name: "小明", slot: 6,  hour: 12, spend: 29800, lead: 303, cpl: 98,  chg: "持平", note: "稳定轮换",       tierC: C.textSub,  cplC: C.yellow, chgC: C.textSub },
  { tier: "—",  name: "薇薇", slot: 2,  hour: 4,  spend: 15200, lead: 153, cpl: 99,  chg: "首秀", note: "首秀亮眼 待观察", tierC: C.textSub,  cplC: C.yellow, chgC: C.textSub },
  { tier: "—",  name: "小黄", slot: 2,  hour: 4,  spend: 9700,  lead: 86,  cpl: 113, chg: "+8%",  note: "样本少",          tierC: C.textSub,  cplC: C.red,    chgC: C.red    },
];
const rowH = 380000;
rows.forEach((r, i) => {
  const ry = ty0 + headerH + i * rowH;
  if (i % 2 === 0) shapes += rect(tx0 + 50000, ry + 10000, tw - 100000, rowH - 20000, C.rowAlt, null);
  const tierX = colX[0], tierY = ry + 80000;
  shapes += rect(tierX, tierY, 200000, 200000, r.tierC, r.tierC);
  shapes += cellText(tierX, tierY, 200000, 200000, 110, true, "FFFFFF", r.tier);
  shapes += cellText(colX[1], ry, colWArr[1], rowH, 110, true, C.text, r.name, "left");
  shapes += cellText(colX[2], ry, colWArr[2], rowH, 110, false, C.text, r.slot.toString());
  shapes += cellText(colX[3], ry, colWArr[3], rowH, 110, false, C.text, r.hour + "h");
  shapes += cellText(colX[4], ry, colWArr[4], rowH, 110, false, C.text, r.spend.toLocaleString("zh-CN"));
  shapes += cellText(colX[5], ry, colWArr[5], rowH, 110, false, C.text, r.lead.toString());
  shapes += cellText(colX[6], ry, colWArr[6], rowH, 130, true, r.cplC, "¥" + r.cpl);
  shapes += cellText(colX[7], ry, colWArr[7], rowH, 110, true, r.chgC, r.chg);
  shapes += cellText(colX[8], ry, colWArr[8], rowH, 90, false, C.textSub, r.note, "left");
});
const totalY = ty0 + headerH + rows.length * rowH + 30000;
shapes += rect(tx0 + 50000, totalY, tw - 100000, 350000, C.totalBg, C.totalBg);
const tcol = [
  { txt: "合计" }, { txt: "—" }, { txt: "55" }, { txt: "110h" },
  { txt: "¥279,500" }, { txt: "2,958" }, { txt: "¥95" }, { txt: "—" }, { txt: "整体水位" },
];
tcol.forEach((t, i) => {
  shapes += cellText(colX[i], totalY, colWArr[i], 350000, 110, true, "FFFFFF", t.txt, i === 8 ? "left" : "center");
});

// === 右侧 图表区 ===
const cx0 = 7400000, cy0 = 1850000, cw = 4580000, ch = 1900000;
shapes += rect(cx0, cy0, cw, ch, C.panelFill, C.panelLine);
shapes += cellText(cx0 + 100000, cy0 + 20000, cw - 200000, 240000, 130, true, C.accent, "📈 消耗 vs CPL 对比");

const cInnerX = cx0 + 200000, cInnerY = cy0 + 320000, cInnerW = cw - 400000, cInnerH = ch - 500000;
const maxV = Math.max(...rows.map(r => r.spend / 1000));
const barH = (cInnerH - 100000) / rows.length;
rows.forEach((r, i) => {
  const by = cInnerY + i * barH;
  const w = Math.round((r.spend / 1000 / maxV) * (cInnerW - 800000));
  shapes += cellText(cInnerX, by + 20000, 350000, barH - 40000, 90, true, C.text, r.name, "left");
  shapes += rect(cInnerX + 380000, by + 40000, w, barH - 80000, r.cpl <= 90 ? C.green : r.cpl <= 100 ? C.yellow : C.red, null);
  shapes += cellText(cInnerX + 380000 + w + 30000, by + 30000, 600000, barH - 60000, 90, true, C.text, "¥" + (r.spend / 1000).toFixed(1) + "k", "left");
});

// === 右侧 洞察区 ===
const ix0 = 7400000, iy0 = 3850000, iw = 4580000, ih = 1700000;
shapes += rect(ix0, iy0, iw, ih, C.panelFill, C.panelLine);
shapes += cellText(ix0 + 100000, iy0 + 20000, iw - 200000, 240000, 130, true, C.accent, "🎯 核心洞察");

const insights = [
  { tag: "🏆 亮点", text: "芝芝量效双升：CPL -11% / 消耗 +14%",  color: C.green },
  { tag: "📈 分工", text: "早午组(张萌/芝芝/三水)控成本 ¥88-91", color: C.headerBg },
  { tag: "⚠️ 风险", text: "小雪放量+46% 但 CPL 同步走高 ¥108",  color: C.yellow },
  { tag: "🔍 观察", text: "薇薇首秀 ¥3791/H + CPL ¥99 待观察",    color: C.accent },
];
insights.forEach((ins, i) => {
  const y = iy0 + 280000 + i * 320000;
  shapes += cellText(ix0 + 150000, y, 700000, 280000, 110, true, ins.color, ins.tag, "left");
  shapes += cellText(ix0 + 850000, y, iw - 950000, 280000, 100, false, C.text, ins.text, "left");
});

// === Footer ===
shapes += cellText(200000, 6600000, 11800000, 200000, 90, false, C.textSub,
  "数据源: 飞书 6月主播班次表 (j69tpS)  |  生成时间: 2026-06-27 17:55  |  爆量君", "left");

// 插入到 </p:spTree> 之前
slide1 = slide1.replace("</p:spTree>", shapes + "</p:spTree>");

// 写回
zip.file("ppt/slides/slide1.xml", slide1);
const newBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
fs.writeFileSync(out, newBuf);
console.log("✅ 已生成:", out);
console.log("📋 母版/版式/主题色/底版背景图全部保留，仅 slide1 内容更新");
