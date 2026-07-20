// gen-anchor-ppt.mjs — 生成 6.20-6.26 主播复试 PPT（单页 16:9）
import PptxGenJS from "pptxgenjs";
import { getLiveWindowLabel } from './monitor-utils.mjs';

// === 配色（与周报 HTML 一致）===
const C = {
  bg:        "0F1923",  // 主底
  card:      "1A2A3A",  // 卡片底
  card2:     "243649",  // 次级卡片
  border:    "2C3E54",  // 描边
  orange:    "FF8800",  // 强调
  orangeDk:  "C66800",
  green:     "34C724",  // 上升/优秀
  blue:      "4E83FD",  // 中性
  red:       "FF5C5C",  // 警示
  yellow:    "FFD24E",  // 标签
  text:      "E0E6ED",  // 主体文字
  textSub:   "8899AA",  // 次要文字
  white:     "FFFFFF",
};

const F = { cnTitle: "Microsoft YaHei", cn: "Microsoft YaHei" };

// === 数据 ===
const data = [
  { name: "张萌", tier: "S",  slot: 15, hour: 30, spend: 75300, lead: 856, cpl: 88,  cph: 2510, change: "+9%",  note: "全队第一 量价双优" },
  { name: "芝芝", tier: "A+", slot: 12, hour: 24, spend: 52500, lead: 587, cpl: 89,  cph: 2187, change: "-11%", note: "本周最大黑马" },
  { name: "小雪", tier: "B+", slot: 8,  hour: 16, spend: 53300, lead: 493, cpl: 108, cph: 3331, change: "+5%",  note: "暴力放量 CPL偏高" },
  { name: "三水", tier: "A",  slot: 10, hour: 20, spend: 43800, lead: 480, cpl: 91,  cph: 2190, change: "+2%",  note: "出勤减 质效持平" },
  { name: "小明", tier: "B",  slot: 6,  hour: 12, spend: 29800, lead: 303, cpl: 98,  cph: 2480, change: "0%",   note: "稳定轮换" },
  { name: "薇薇", tier: "—",  slot: 2,  hour: 4,  spend: 15200, lead: 153, cpl: 99,  cph: 3791, change: "首秀", note: "首秀亮眼 待观察" },
  { name: "小黄", tier: "—",  slot: 2,  hour: 4,  spend: 9700,  lead: 86,  cpl: 113, cph: 2434, change: "+8%",  note: "样本少" },
];

const totalSpend = data.reduce((s, d) => s + d.spend, 0);
const totalLead  = data.reduce((s, d) => s + d.lead, 0);
const totalSlot  = data.reduce((s, d) => s + d.slot, 0);
const totalHour  = data.reduce((s, d) => s + d.hour, 0);
const avgCpl     = Math.round(totalSpend / totalLead);

const tierColor = (t) => ({ "S": C.orange, "A+": C.green, "A": C.blue, "B+": C.yellow, "B": C.textSub, "—": C.textSub }[t] || C.textSub);
const cplColor   = (c) => c <= 90 ? C.green : c <= 100 ? C.yellow : C.red;
const fmt        = (n) => n.toLocaleString("zh-CN");

// === 初始化 ===

const liveWin = getLiveWindowLabel();
const pres = new PptxGenJS();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in (33.87 x 19.05 cm)
pres.title  = "主播复试 6.20-6.26";
pres.author = "爆量君";

const slide = pres.addSlide();
slide.background = { color: C.bg };

// ===== 1. 标题栏 =====
slide.addShape("rect", { x: 0, y: 0, w: 13.33, h: 0.95, fill: { color: C.card }, line: { color: C.border, width: 0.5 } });
slide.addShape("rect", { x: 0, y: 0.95, w: 13.33, h: 0.05, fill: { color: C.orange }, line: { color: C.orange, width: 0 } });
slide.addText("📺 主播复试  ·  6月20-26日", {
  x: 0.4, y: 0.1, w: 9, h: 0.75, fontSize: 26, bold: true, color: C.text, fontFace: F.cnTitle, align: "left", valign: "middle",
});
slide.addText("极狐-区域福利号-直播  |  真人号  ·  ${liveWin.durationHours}h (${liveWin.startTime.replace(':', '')}-${liveWin.endTime.replace(':', '')})", {
  x: 9.5, y: 0.25, w: 3.5, h: 0.45, fontSize: 11, color: C.textSub, fontFace: F.cn, align: "right", valign: "middle",
});

// ===== 2. KPI 4卡 =====
const kpiY = 1.2, kpiH = 1.05, kpiW = 3.05, gap = 0.15;
const kpiData = [
  { label: "本周总消耗",  value: "¥27.95万", sub: `日均 ¥3.99万`, color: C.orange },
  { label: "总线索量",   value: fmt(totalLead), sub: `平均 CPL ¥${avgCpl}`, color: C.green },
  { label: "班次",       value: fmt(totalSlot), sub: `总时长 ${totalHour}h`, color: C.blue },
  { label: "最高消耗/H", value: "¥3331",       sub: "小雪 (晚高峰)",     color: C.yellow },
];
kpiData.forEach((k, i) => {
  const x = 0.4 + i * (kpiW + gap);
  slide.addShape("roundRect", { x, y: kpiY, w: kpiW, h: kpiH, fill: { color: C.card }, line: { color: C.border, width: 0.75 }, rectRadius: 0.08 });
  slide.addShape("rect", { x, y: kpiY, w: 0.08, h: kpiH, fill: { color: k.color }, line: { color: k.color, width: 0 } });
  slide.addText(k.label, { x: x + 0.25, y: kpiY + 0.08, w: kpiW - 0.3, h: 0.3, fontSize: 10, color: C.textSub, fontFace: F.cn, align: "left" });
  slide.addText(k.value, { x: x + 0.25, y: kpiY + 0.36, w: kpiW - 0.3, h: 0.5, fontSize: 24, bold: true, color: k.color, fontFace: F.cnTitle, align: "left" });
  slide.addText(k.sub,   { x: x + 0.25, y: kpiY + 0.78, w: kpiW - 0.3, h: 0.22, fontSize: 9, color: C.textSub, fontFace: F.cn, align: "left" });
});

// ===== 3. 主播数据表 =====
const tableX = 0.4, tableY = 2.5, tableW = 6.4, tableRowH = 0.42;
slide.addShape("roundRect", { x: tableX, y: tableY, w: tableW, h: 3.85, fill: { color: C.card }, line: { color: C.border, width: 0.75 }, rectRadius: 0.06 });
slide.addText("📊 主播数据明细", {
  x: tableX + 0.2, y: tableY + 0.08, w: tableW - 0.4, h: 0.32, fontSize: 13, bold: true, color: C.orange, fontFace: F.cnTitle, align: "left",
});

const colW = [0.6, 0.9, 0.7, 0.6, 1.1, 0.7, 0.6, 1.2]; // 梯队 / 主播 / 班次 / 时长 / 消耗 / 线索 / CPL / 备注
const startX = tableX + 0.2;
const headerY = tableY + 0.5;
const headers = ["梯队", "主播", "班次", "时长", "消耗(¥)", "线索", "CPL(¥)", "备注"];
let cx = startX;
headers.forEach((h, i) => {
  slide.addText(h, { x: cx, y: headerY, w: colW[i], h: 0.32, fontSize: 10, bold: true, color: C.textSub, fontFace: F.cn, align: "center", valign: "middle" });
  cx += colW[i];
});
// 表头分隔线
slide.addShape("line", { x: tableX + 0.2, y: headerY + 0.32, w: tableW - 0.4, h: 0, line: { color: C.border, width: 1 } });

data.forEach((d, i) => {
  const ry = headerY + 0.35 + i * tableRowH;
  cx = startX;
  // 行底色交替
  if (i % 2 === 0) {
    slide.addShape("rect", { x: tableX + 0.15, y: ry - 0.02, w: tableW - 0.3, h: tableRowH - 0.02, fill: { color: C.card2 }, line: { color: C.card2, width: 0 } });
  }
  // 梯队色块
  slide.addShape("roundRect", { x: cx + 0.05, y: ry + 0.07, w: 0.5, h: 0.26, fill: { color: tierColor(d.tier) }, line: { color: tierColor(d.tier), width: 0 }, rectRadius: 0.04 });
  slide.addText(d.tier, { x: cx + 0.05, y: ry + 0.07, w: 0.5, h: 0.26, fontSize: 10, bold: true, color: C.bg, fontFace: F.cn, align: "center", valign: "middle" });
  cx += colW[0];

  const cells = [
    { t: d.name, bold: true, color: C.text },
    { t: fmt(d.slot), color: C.text },
    { t: d.hour + "h", color: C.text },
    { t: fmt(d.spend), color: C.text },
    { t: fmt(d.lead), color: C.text },
    { t: d.cpl.toString(), bold: true, color: cplColor(d.cpl) },
    { t: d.note, color: C.textSub, size: 9 },
  ];
  cells.forEach((c, j) => {
    slide.addText(c.t, { x: cx, y: ry, w: colW[j + 1], h: 0.4, fontSize: c.size || 11, bold: c.bold || false, color: c.color, fontFace: F.cn, align: j === 6 ? "left" : "center", valign: "middle" });
    cx += colW[j + 1];
  });
});

// 合计行
const totalY = headerY + 0.35 + data.length * tableRowH + 0.05;
slide.addShape("rect", { x: tableX + 0.15, y: totalY - 0.02, w: tableW - 0.3, h: 0.4, fill: { color: C.orangeDk }, line: { color: C.orangeDk, width: 0 } });
slide.addText("合计", { x: startX + 0.05, y: totalY, w: 0.5, h: 0.36, fontSize: 10, bold: true, color: C.white, fontFace: F.cn, align: "center", valign: "middle" });
slide.addText(`${totalSlot}班次 / ${totalHour}h`, { x: startX + colW[0], y: totalY, w: colW[1] + colW[2], h: 0.36, fontSize: 10, bold: true, color: C.white, fontFace: F.cn, align: "center", valign: "middle" });
slide.addText(`¥${fmt(totalSpend)}`, { x: startX + colW[0] + colW[1] + colW[2], y: totalY, w: colW[3], h: 0.36, fontSize: 10, bold: true, color: C.white, fontFace: F.cn, align: "center", valign: "middle" });
slide.addText(fmt(totalLead), { x: startX + colW[0] + colW[1] + colW[2] + colW[3], y: totalY, w: colW[4], h: 0.36, fontSize: 10, bold: true, color: C.white, fontFace: F.cn, align: "center", valign: "middle" });
slide.addText(`¥${avgCpl}`, { x: startX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4], y: totalY, w: colW[5], h: 0.36, fontSize: 10, bold: true, color: C.white, fontFace: F.cn, align: "center", valign: "middle" });
slide.addText("整体水位", { x: startX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + colW[5], y: totalY, w: colW[6], h: 0.36, fontSize: 10, color: C.white, fontFace: F.cn, align: "left", valign: "middle" });

// ===== 4. CPL vs 消耗 双轴图 =====
const chartX = 7.0, chartY = 2.5, chartW = 5.9, chartH = 1.9;
slide.addShape("roundRect", { x: chartX, y: chartY, w: chartW, h: chartH, fill: { color: C.card }, line: { color: C.border, width: 0.75 }, rectRadius: 0.06 });
slide.addText("📈 消耗 vs CPL 对比", {
  x: chartX + 0.2, y: chartY + 0.08, w: chartW - 0.4, h: 0.32, fontSize: 13, bold: true, color: C.orange, fontFace: F.cnTitle, align: "left",
});

// 柱状图（消耗）
const chartInnerX = chartX + 0.4, chartInnerY = chartY + 0.5, chartInnerW = chartW - 0.6, chartInnerH = chartH - 0.7;
const barNames = data.map(d => d.name);
const barSpend = data.map(d => d.spend / 1000); // 转千元
const barCpl   = data.map(d => d.cpl);

slide.addChart(pres.ChartType.bar, [
  { name: "消耗(千元)", labels: barNames, values: barSpend },
], {
  x: chartInnerX, y: chartInnerY, w: chartInnerW, h: chartInnerH,
  barDir: "col",
  barGapWidthPct: 30,
  chartColors: [C.orange],
  chartColorsOpacity: 80,
  showValue: true,
  dataLabelColor: C.text,
  dataLabelFontSize: 8,
  dataLabelFontFace: F.cn,
  dataLabelFormatCode: "0.0",
  catAxisLabelColor: C.text,
  catAxisLabelFontSize: 9,
  catAxisLabelFontFace: F.cn,
  valAxisLabelColor: C.textSub,
  valAxisLabelFontSize: 8,
  valAxisLabelFontFace: F.cn,
  valAxisTitle: "消耗 (千元)",
  valAxisTitleColor: C.textSub,
  valAxisTitleFontSize: 9,
  valAxisTitleFontFace: F.cn,
  showValAxisTitle: true,
  showLegend: true,
  legendPos: "b",
  legendColor: C.textSub,
  legendFontSize: 9,
  legendFontFace: F.cn,
  plotArea: { fill: { color: C.card2 } },
});

// ===== 5. 梯队 + 洞察 =====
const insightX = 7.0, insightY = 4.55, insightW = 5.9, insightH = 1.8;
slide.addShape("roundRect", { x: insightX, y: insightY, w: insightW, h: insightH, fill: { color: C.card }, line: { color: C.border, width: 0.75 }, rectRadius: 0.06 });
slide.addText("🎯 核心洞察", {
  x: insightX + 0.2, y: insightY + 0.08, w: insightW - 0.4, h: 0.32, fontSize: 13, bold: true, color: C.orange, fontFace: F.cnTitle, align: "left",
});

const insights = [
  { tag: "🏆 亮点",   text: "芝芝量效双升：CPL -11% / 消耗 +14%，本周最大黑马" },
  { tag: "📈 分工",   text: "早午组（张萌/芝芝/三水）控成本 ¥88-91，晚间组（小雪/小明）扩消耗填预算" },
  { tag: "⚠️ 风险",   text: "小雪放量 +46% 但 CPL 同步走高（¥108），边际成本上升" },
  { tag: "🔍 观察",   text: "薇薇首秀 ¥3791/H + CPL ¥99，建议下周扩大样本观察" },
];

insights.forEach((ins, i) => {
  const y = insightY + 0.5 + i * 0.3;
  slide.addText(ins.tag, { x: insightX + 0.25, y, w: 1.0, h: 0.28, fontSize: 10, bold: true, color: C.orange, fontFace: F.cn, align: "left", valign: "middle" });
  slide.addText(ins.text, { x: insightX + 1.3, y, w: insightW - 1.5, h: 0.28, fontSize: 10, color: C.text, fontFace: F.cn, align: "left", valign: "middle" });
});

// ===== 6. 底部 footer =====
slide.addShape("line", { x: 0.4, y: 7.05, w: 12.55, h: 0, line: { color: C.border, width: 0.5 } });
slide.addText("数据源: 飞书 6月主播班次表 (j69tpS)  |  生成时间: 2026-06-27 17:20  |  爆量君", {
  x: 0.4, y: 7.1, w: 12.55, h: 0.3, fontSize: 9, color: C.textSub, fontFace: F.cn, align: "left", valign: "middle",
});

// === 保存 ===
const out = "E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\主播复试_6月20-26日.pptx";
await pres.writeFile({ fileName: out });
console.log("✅ 已生成:", out);
