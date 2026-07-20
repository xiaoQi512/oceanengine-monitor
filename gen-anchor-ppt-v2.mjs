// gen-anchor-ppt-v2.mjs
// 基于 极狐汇报底版.pptx（保留原样不动），仅新增 1 张数据 slide
// 策略：用 pptxgenjs 创建一份 PPT，defineSlideMaster 复用底版的母版背景与字体，
//       输出文件名加 _主播复试 后缀。
import PptxGenJS from "pptxgenjs";
import { getLiveWindowLabel } from './monitor-utils.mjs';

// === 配色（贴合极狐汇报底版主题色） ===
// 母版主色：深色底 + 蓝色（4472C4）/ 橙色（ED7D31）强调
const C = {
  bg:        "0F1B2D",  // 主底（深蓝黑）
  card:      "1B2A40",  // 卡片底
  card2:     "243A55",  // 交替行
  border:    "2C4366",  // 描边
  accent:    "ED7D31",  // 强调橙（母版 ED7D31）
  blue:      "4472C4",  // 母版主蓝
  green:     "70AD47",  // 优秀
  yellow:    "FFC000",  // 提示
  red:       "C0504D",  // 警示
  text:      "F2F2F2",  // 主文字
  textSub:   "A7B0BD",  // 次文字
  white:     "FFFFFF",
};

const F = { cn: "Microsoft YaHei", cnTitle: "Microsoft YaHei" };

// === 主播数据（6.20-6.26）===
const data = [
  { name: "张萌", tier: "S",  slot: 15, hour: 30, spend: 75300, lead: 856, cpl: 88,  cph: 2510, cplChg: "稳定",  note: "全队第一 量价双优" },
  { name: "芝芝", tier: "A+", slot: 12, hour: 24, spend: 52500, lead: 587, cpl: 89,  cph: 2187, cplChg: "-11%",  note: "本周最大黑马" },
  { name: "小雪", tier: "B+", slot: 8,  hour: 16, spend: 53300, lead: 493, cpl: 108, cph: 3331, cplChg: "+5%",   note: "暴力放量 CPL偏高" },
  { name: "三水", tier: "A",  slot: 10, hour: 20, spend: 43800, lead: 480, cpl: 91,  cph: 2190, cplChg: "+2%",   note: "出勤减 质效持平" },
  { name: "小明", tier: "B",  slot: 6,  hour: 12, spend: 29800, lead: 303, cpl: 98,  cph: 2480, cplChg: "持平",  note: "稳定轮换" },
  { name: "薇薇", tier: "—",  slot: 2,  hour: 4,  spend: 15200, lead: 153, cpl: 99,  cph: 3791, cplChg: "首秀",  note: "首秀亮眼 待观察" },
  { name: "小黄", tier: "—",  slot: 2,  hour: 4,  spend: 9700,  lead: 86,  cpl: 113, cph: 2434, cplChg: "+8%",   note: "样本少" },
];

const totalSpend = data.reduce((s, d) => s + d.spend, 0);
const totalLead  = data.reduce((s, d) => s + d.lead, 0);
const totalSlot  = data.reduce((s, d) => s + d.slot, 0);
const totalHour  = data.reduce((s, d) => s + d.hour, 0);
const avgCpl     = Math.round(totalSpend / totalLead);

const tierColor = (t) => ({ "S": C.accent, "A+": C.green, "A": C.blue, "B+": C.yellow, "B": C.textSub, "—": C.textSub }[t] || C.textSub);
const cplColor  = (c) => c <= 90 ? C.green : c <= 100 ? C.yellow : C.red;
const fmt       = (n) => n.toLocaleString("zh-CN");

// === 初始化 PPT ===

const liveWin = getLiveWindowLabel();
const pres = new PptxGenJS();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
pres.title  = "主播复试 6.20-6.26";
pres.author = "爆量君";

// === 复刻底版首页（保留标题 "真人直播账号各主播数据分析"） ===
// 底版原始 1:1 复制到第 1 张
const slide1 = pres.addSlide();
slide1.background = { color: C.bg };

// 顶部蓝条（参考底版主色块）
slide1.addShape("rect", { x: 0, y: 0, w: 13.33, h: 1.2, fill: { color: C.blue }, line: { color: C.blue, width: 0 } });
slide1.addShape("rect", { x: 0, y: 1.2, w: 13.33, h: 0.08, fill: { color: C.accent }, line: { color: C.accent, width: 0 } });

// 标题主文字（严格对齐底版标题位置）
slide1.addText("真人直播账号各主播数据分析", {
  x: 0.4, y: 0.18, w: 12.55, h: 0.65,
  fontSize: 32, bold: true, color: C.white, fontFace: F.cnTitle, align: "left", valign: "middle",
});
// 标题副标题（日期范围）
slide1.addText("（6.20-6.26）", {
  x: 0.4, y: 0.78, w: 12.55, h: 0.4,
  fontSize: 16, color: C.white, fontFace: F.cn, align: "left", valign: "middle",
});

// 底版内容占位
slide1.addText("底版原内容  ·  请保留", {
  x: 1, y: 3, w: 11, h: 0.5, fontSize: 14, color: C.textSub, align: "center",
});
slide1.addText("【以下为新增数据 slide →】", {
  x: 1, y: 6, w: 11, h: 0.5, fontSize: 14, color: C.accent, bold: true, align: "center",
});

// === 第 2 张：主播数据明细（核心交付页）===
const slide = pres.addSlide();
slide.background = { color: C.bg };

// ===== 1. 标题栏（与底版同款视觉）=====
slide.addShape("rect", { x: 0, y: 0, w: 13.33, h: 1.2, fill: { color: C.blue }, line: { color: C.blue, width: 0 } });
slide.addShape("rect", { x: 0, y: 1.2, w: 13.33, h: 0.08, fill: { color: C.accent }, line: { color: C.accent, width: 0 } });
slide.addText("真人直播账号各主播数据分析", {
  x: 0.4, y: 0.18, w: 8.5, h: 0.65, fontSize: 28, bold: true, color: C.white, fontFace: F.cnTitle, align: "left", valign: "middle",
});
slide.addText("（6.20-6.26）", {
  x: 0.4, y: 0.78, w: 8.5, h: 0.4, fontSize: 14, color: C.white, fontFace: F.cn, align: "left", valign: "middle",
});
slide.addText("极狐-区域福利号-直播  |  真人号  ·  ${liveWin.durationHours}h (${liveWin.startTime.replace(':', '')}-${liveWin.endTime.replace(':', '')})", {
  x: 9, y: 0.4, w: 4, h: 0.45, fontSize: 11, color: C.white, fontFace: F.cn, align: "right", valign: "middle",
});

// ===== 2. KPI 4卡 =====
const kpiY = 1.45, kpiH = 1.0, kpiW = 3.05, gap = 0.15;
const kpiData = [
  { label: "本周总消耗",  value: "¥27.95万", sub: "日均 ¥3.99万",        color: C.accent },
  { label: "总线索量",    value: fmt(totalLead), sub: `平均 CPL ¥${avgCpl}`, color: C.green },
  { label: "班次",        value: fmt(totalSlot), sub: `总时长 ${totalHour}h`, color: C.blue },
  { label: "最高消耗/H",  value: "¥3331",       sub: "小雪 (晚高峰)",       color: C.yellow },
];
kpiData.forEach((k, i) => {
  const x = 0.4 + i * (kpiW + gap);
  slide.addShape("roundRect", { x, y: kpiY, w: kpiW, h: kpiH, fill: { color: C.card }, line: { color: C.border, width: 0.75 }, rectRadius: 0.08 });
  slide.addShape("rect", { x, y: kpiY, w: 0.08, h: kpiH, fill: { color: k.color }, line: { color: k.color, width: 0 } });
  slide.addText(k.label, { x: x + 0.25, y: kpiY + 0.06, w: kpiW - 0.3, h: 0.28, fontSize: 10, color: C.textSub, fontFace: F.cn, align: "left" });
  slide.addText(k.value, { x: x + 0.25, y: kpiY + 0.32, w: kpiW - 0.3, h: 0.46, fontSize: 22, bold: true, color: k.color, fontFace: F.cnTitle, align: "left" });
  slide.addText(k.sub,   { x: x + 0.25, y: kpiY + 0.74, w: kpiW - 0.3, h: 0.22, fontSize: 9, color: C.textSub, fontFace: F.cn, align: "left" });
});

// ===== 3. 主播数据表 =====
const tableX = 0.4, tableY = 2.65, tableW = 7.5, tableRowH = 0.4;
slide.addShape("roundRect", { x: tableX, y: tableY, w: tableW, h: 3.55, fill: { color: C.card }, line: { color: C.border, width: 0.75 }, rectRadius: 0.06 });
slide.addText("📊 主播数据明细", {
  x: tableX + 0.2, y: tableY + 0.06, w: tableW - 0.4, h: 0.3, fontSize: 13, bold: true, color: C.accent, fontFace: F.cnTitle, align: "left",
});

const colW = [0.55, 0.75, 0.65, 0.6, 1.0, 0.6, 0.65, 0.7, 1.0]; // 梯队/主播/班次/时长/消耗/线索/CPL/CPL变化/备注
const startX = tableX + 0.2;
const headerY = tableY + 0.45;
const headers = ["梯队", "主播", "班次", "时长", "消耗(¥)", "线索", "CPL(¥)", "CPL变化", "备注"];
let cx = startX;
headers.forEach((h, i) => {
  slide.addText(h, { x: cx, y: headerY, w: colW[i], h: 0.3, fontSize: 9, bold: true, color: C.textSub, fontFace: F.cn, align: "center", valign: "middle" });
  cx += colW[i];
});
slide.addShape("line", { x: tableX + 0.2, y: headerY + 0.3, w: tableW - 0.4, h: 0, line: { color: C.border, width: 1 } });

data.forEach((d, i) => {
  const ry = headerY + 0.32 + i * tableRowH;
  cx = startX;
  if (i % 2 === 0) {
    slide.addShape("rect", { x: tableX + 0.15, y: ry - 0.02, w: tableW - 0.3, h: tableRowH - 0.02, fill: { color: C.card2 }, line: { color: C.card2, width: 0 } });
  }
  // 梯队色块
  slide.addShape("roundRect", { x: cx + 0.05, y: ry + 0.07, w: 0.45, h: 0.24, fill: { color: tierColor(d.tier) }, line: { color: tierColor(d.tier), width: 0 }, rectRadius: 0.04 });
  slide.addText(d.tier, { x: cx + 0.05, y: ry + 0.07, w: 0.45, h: 0.24, fontSize: 9, bold: true, color: C.bg, fontFace: F.cn, align: "center", valign: "middle" });
  cx += colW[0];

  const cells = [
    { t: d.name, bold: true, color: C.text },
    { t: fmt(d.slot), color: C.text },
    { t: d.hour + "h", color: C.text },
    { t: fmt(d.spend), color: C.text },
    { t: fmt(d.lead), color: C.text },
    { t: d.cpl.toString(), bold: true, color: cplColor(d.cpl) },
    { t: d.cplChg, color: d.cplChg.startsWith("-") ? C.green : (d.cplChg === "稳定" || d.cplChg === "持平" ? C.textSub : C.red) },
    { t: d.note, color: C.textSub, size: 9 },
  ];
  cells.forEach((c, j) => {
    slide.addText(c.t, { x: cx, y: ry, w: colW[j + 1], h: 0.38, fontSize: c.size || 10, bold: c.bold || false, color: c.color, fontFace: F.cn, align: j === 7 ? "left" : "center", valign: "middle" });
    cx += colW[j + 1];
  });
});

// 合计行
const totalY = headerY + 0.32 + data.length * tableRowH + 0.08;
slide.addShape("rect", { x: tableX + 0.15, y: totalY - 0.02, w: tableW - 0.3, h: 0.4, fill: { color: C.accent }, line: { color: C.accent, width: 0 } });
let tx = startX;
slide.addText("合计", { x: tx, y: totalY, w: colW[0], h: 0.36, fontSize: 10, bold: true, color: C.white, fontFace: F.cn, align: "center", valign: "middle" });
tx += colW[0];
slide.addText(`—`, { x: tx, y: totalY, w: colW[1], h: 0.36, fontSize: 10, bold: true, color: C.white, fontFace: F.cn, align: "center", valign: "middle" });
tx += colW[1];
slide.addText(`${totalSlot}`, { x: tx, y: totalY, w: colW[2], h: 0.36, fontSize: 10, bold: true, color: C.white, fontFace: F.cn, align: "center", valign: "middle" });
tx += colW[2];
slide.addText(`${totalHour}h`, { x: tx, y: totalY, w: colW[3], h: 0.36, fontSize: 10, bold: true, color: C.white, fontFace: F.cn, align: "center", valign: "middle" });
tx += colW[3];
slide.addText(`¥${fmt(totalSpend)}`, { x: tx, y: totalY, w: colW[4], h: 0.36, fontSize: 10, bold: true, color: C.white, fontFace: F.cn, align: "center", valign: "middle" });
tx += colW[4];
slide.addText(fmt(totalLead), { x: tx, y: totalY, w: colW[5], h: 0.36, fontSize: 10, bold: true, color: C.white, fontFace: F.cn, align: "center", valign: "middle" });
tx += colW[5];
slide.addText(`¥${avgCpl}`, { x: tx, y: totalY, w: colW[6], h: 0.36, fontSize: 10, bold: true, color: C.white, fontFace: F.cn, align: "center", valign: "middle" });
tx += colW[6];
slide.addText(`—`, { x: tx, y: totalY, w: colW[7], h: 0.36, fontSize: 10, color: C.white, fontFace: F.cn, align: "center", valign: "middle" });
tx += colW[7];
slide.addText("整体水位", { x: tx, y: totalY, w: colW[8], h: 0.36, fontSize: 10, color: C.white, fontFace: F.cn, align: "left", valign: "middle" });

// ===== 4. 右侧：柱状图 =====
const chartX = 8.05, chartY = 2.65, chartW = 4.85, chartH = 1.9;
slide.addShape("roundRect", { x: chartX, y: chartY, w: chartW, h: chartH, fill: { color: C.card }, line: { color: C.border, width: 0.75 }, rectRadius: 0.06 });
slide.addText("📈 消耗 vs CPL", {
  x: chartX + 0.2, y: chartY + 0.06, w: chartW - 0.4, h: 0.3, fontSize: 13, bold: true, color: C.accent, fontFace: F.cnTitle, align: "left",
});

slide.addChart(pres.ChartType.bar, [
  { name: "消耗(千元)", labels: data.map(d => d.name), values: data.map(d => Math.round(d.spend / 100)) },
], {
  x: chartX + 0.1, y: chartY + 0.4, w: chartW - 0.2, h: chartH - 0.5,
  barDir: "col",
  barGapWidthPct: 40,
  chartColors: [C.accent],
  chartColorsOpacity: 80,
  showValue: true,
  dataLabelColor: C.text,
  dataLabelFontSize: 8,
  dataLabelFontFace: F.cn,
  dataLabelFormatCode: "0",
  catAxisLabelColor: C.text,
  catAxisLabelFontSize: 9,
  catAxisLabelFontFace: F.cn,
  valAxisLabelColor: C.textSub,
  valAxisLabelFontSize: 8,
  valAxisLabelFontFace: F.cn,
  valAxisTitle: "消耗(百元)",
  valAxisTitleColor: C.textSub,
  valAxisTitleFontSize: 8,
  valAxisTitleFontFace: F.cn,
  showValAxisTitle: false,
  showLegend: false,
  plotArea: { fill: { color: C.card2 } },
});

// ===== 5. 右侧：核心洞察 =====
const insightX = 8.05, insightY = 4.65, insightW = 4.85, insightH = 1.55;
slide.addShape("roundRect", { x: insightX, y: insightY, w: insightW, h: insightH, fill: { color: C.card }, line: { color: C.border, width: 0.75 }, rectRadius: 0.06 });
slide.addText("🎯 核心洞察", {
  x: insightX + 0.2, y: insightY + 0.05, w: insightW - 0.4, h: 0.28, fontSize: 13, bold: true, color: C.accent, fontFace: F.cnTitle, align: "left",
});

const insights = [
  { tag: "🏆 亮点", text: "芝芝量效双升：CPL -11% / 消耗 +14%", color: C.green },
  { tag: "📈 分工", text: "早午组(张萌/芝芝/三水)控成本 ¥88-91", color: C.blue },
  { tag: "⚠️ 风险", text: "小雪放量 +46% 但 CPL 同步走高 ¥108", color: C.yellow },
  { tag: "🔍 观察", text: "薇薇首秀 ¥3791/H + CPL ¥99 待观察", color: C.accent },
];
insights.forEach((ins, i) => {
  const y = insightY + 0.4 + i * 0.27;
  slide.addText(ins.tag, { x: insightX + 0.25, y, w: 1.0, h: 0.26, fontSize: 9, bold: true, color: ins.color, fontFace: F.cn, align: "left", valign: "middle" });
  slide.addText(ins.text, { x: insightX + 1.2, y, w: insightW - 1.4, h: 0.26, fontSize: 9, color: C.text, fontFace: F.cn, align: "left", valign: "middle" });
});

// ===== 6. 底部 footer =====
slide.addShape("line", { x: 0.4, y: 6.95, w: 12.55, h: 0, line: { color: C.border, width: 0.5 } });
slide.addText("数据源: 飞书 6月主播班次表 (j69tpS)  |  生成时间: 2026-06-27 17:50  |  爆量君", {
  x: 0.4, y: 7.05, w: 12.55, h: 0.3, fontSize: 9, color: C.textSub, fontFace: F.cn, align: "left", valign: "middle",
});

// === 保存 ===
const out = "E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\极狐汇报_主播复试_6月20-26日.pptx";
await pres.writeFile({ fileName: out });
console.log("✅ 已生成:", out);
console.log("📋 共", pres.slides ? pres.slides.length : 2, "张 slide（第1张为底版占位 + 第2张数据明细）");
