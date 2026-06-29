"""生成3种素雅风格的HTML预览，供主人对比选型。
三种风格共用同一份数据，差异在排版/配色/视觉密度。
"""
import os
from pathlib import Path

OUT_DIR = Path("E:/炼丹炉/WorkBuddy/巨量引擎监控")

# ====== 共用数据 ======
ANCHORS = [
    {"tier": "S",  "name": "张萌", "slot": 15, "hour": 30, "spend": 75300, "lead": 856, "cpl": 88,  "chg": "稳定", "note": "全队第一 量价双优"},
    {"tier": "A+", "name": "芝芝", "slot": 12, "hour": 24, "spend": 52500, "lead": 587, "cpl": 89,  "chg": "−11%", "note": "本周最大黑马"},
    {"tier": "B+", "name": "小雪", "slot": 8,  "hour": 16, "spend": 53300, "lead": 493, "cpl": 108, "chg": "+5%",  "note": "暴力放量 CPL偏高"},
    {"tier": "A",  "name": "三水", "slot": 10, "hour": 20, "spend": 43800, "lead": 480, "cpl": 91,  "chg": "+2%",  "note": "出勤减 质效持平"},
    {"tier": "B",  "name": "小明", "slot": 6,  "hour": 12, "spend": 29800, "lead": 303, "cpl": 98,  "chg": "持平", "note": "稳定轮换"},
    {"tier": "—",  "name": "薇薇", "slot": 2,  "hour": 4,  "spend": 15200, "lead": 153, "cpl": 99,  "chg": "首秀", "note": "首秀亮眼 待观察"},
    {"tier": "—",  "name": "小黄", "slot": 2,  "hour": 4,  "spend": 9700,  "lead": 86,  "cpl": 113, "chg": "+8%",  "note": "样本少"},
]
TOTAL = {"slot": 55, "hour": 110, "spend": 279500, "lead": 2958, "cpl": 95}
KPIS = [
    {"label": "本周总消耗", "value": "¥27.95万", "sub": "日均 ¥3.99万"},
    {"label": "总线索量",   "value": "2,958",   "sub": "CPL ¥95"},
    {"label": "班次",       "value": "55",      "sub": "总时长 110h"},
    {"label": "最高消耗/H", "value": "¥3,331",  "sub": "小雪(晚高峰)"},
]


# ============================================================
# 方案 A：极简白底（白底 + 浅灰描边 + 母版蓝点睛）
# ============================================================
HTML_A = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>方案A · 极简白底</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #F0F2F5; font-family: -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif; padding: 20px; }
.slide {
  width: 1280px; height: 720px; margin: 0 auto;
  background: #FFFFFF; padding: 40px 48px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  position: relative;
}
.title { display: flex; align-items: baseline; gap: 16px; margin-bottom: 6px; }
.title h1 { font-size: 22px; font-weight: 600; color: #1F2937; letter-spacing: 0.5px; }
.title .sub { font-size: 12px; color: #6B7280; }
.rule { height: 1px; background: #E5E7EB; margin: 12px 0 20px; }

/* KPI */
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border-top: 1px solid #E5E7EB; border-bottom: 1px solid #E5E7EB; }
.kpi { padding: 16px 20px; border-right: 1px solid #E5E7EB; }
.kpi:last-child { border-right: none; }
.kpi .lbl { font-size: 11px; color: #6B7280; margin-bottom: 6px; }
.kpi .val { font-size: 24px; font-weight: 600; color: #1F2937; }
.kpi .sub { font-size: 10px; color: #9CA3AF; margin-top: 2px; }
.kpi .val.acc { color: #1F5BAA; }

/* Two columns */
.main { display: grid; grid-template-columns: 1.6fr 1fr; gap: 28px; margin-top: 22px; }
.section h2 {
  font-size: 12px; font-weight: 600; color: #6B7280;
  text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;
}

/* Table */
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { text-align: center; padding: 8px 6px; border-bottom: 1px solid #F3F4F6; }
th { color: #6B7280; font-weight: 500; font-size: 10px; letter-spacing: 0.5px; }
td.name { font-weight: 600; color: #1F2937; text-align: left; padding-left: 10px; }
.tier { display: inline-block; font-size: 10px; font-weight: 600; color: #1F5BAA; min-width: 18px; }
.cpl-good { color: #1F5BAA; font-weight: 600; }
.cpl-warn { color: #B45309; }
.cpl-bad  { color: #B91C1C; }
.up   { color: #B91C1C; }
.down { color: #047857; }
tr:hover { background: #F9FAFB; }
.total td { font-weight: 600; color: #1F5BAA; border-top: 1px solid #1F5BAA; border-bottom: none; padding-top: 10px; }

/* Right column */
.right { display: flex; flex-direction: column; gap: 20px; }
.chart .bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 11px; }
.chart .nm { width: 32px; color: #1F2937; font-weight: 500; }
.chart .bar { height: 8px; background: #1F5BAA; border-radius: 0; }
.chart .bar.warn { background: #B45309; }
.chart .bar.bad  { background: #B91C1C; }
.chart .vl { color: #6B7280; font-size: 10px; }
.insights .ins { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px dashed #E5E7EB; font-size: 11px; }
.insights .ins:last-child { border-bottom: none; }
.insights .tg { color: #1F5BAA; font-weight: 600; min-width: 60px; }

.footer { position: absolute; bottom: 16px; left: 48px; right: 48px;
  display: flex; justify-content: space-between; font-size: 9px; color: #9CA3AF; }
</style>
</head>
<body>
<div class="slide">
  <div class="title">
    <h1>主播能力复盘</h1>
    <span class="sub">2026.06.20 — 06.26 · 极狐区域号</span>
  </div>
  <div class="rule"></div>

  <div class="kpis">
    <div class="kpi"><div class="lbl">本周总消耗</div><div class="val acc">¥27.95万</div><div class="sub">日均 ¥3.99万</div></div>
    <div class="kpi"><div class="lbl">总线索量</div><div class="val">2,958</div><div class="sub">CPL ¥95</div></div>
    <div class="kpi"><div class="lbl">班次</div><div class="val">55</div><div class="sub">总时长 110h</div></div>
    <div class="kpi"><div class="lbl">最高消耗/H</div><div class="val">¥3,331</div><div class="sub">小雪(晚高峰)</div></div>
  </div>

  <div class="main">
    <div class="section">
      <h2>主播明细</h2>
      <table>
        <thead>
          <tr><th>梯队</th><th>主播</th><th>班次</th><th>时长</th><th>消耗(元)</th><th>线索</th><th>CPL</th><th>变化</th><th>评价</th></tr>
        </thead>
        <tbody>
__ROWS_A__
          <tr class="total"><td>—</td><td class="name">合计</td><td>55</td><td>110h</td><td>¥279,500</td><td>2,958</td><td>¥95</td><td>—</td><td style="text-align:left">整体水位</td></tr>
        </tbody>
      </table>
    </div>

    <div class="right">
      <div class="section chart">
        <h2>消耗对比 (元)</h2>
__CHART_A__
      </div>

      <div class="section insights">
        <h2>核心洞察</h2>
        <div class="ins"><span class="tg">亮点</span><span>芝芝量效双升：CPL −11% / 消耗 +14%</span></div>
        <div class="ins"><span class="tg">分工</span><span>早午组(张萌/芝芝/三水)控成本 ¥88–91</span></div>
        <div class="ins"><span class="tg">风险</span><span>小雪放量+46% 但 CPL 走高至 ¥108</span></div>
        <div class="ins"><span class="tg">观察</span><span>薇薇首秀 ¥3,791/H + CPL ¥99 待观察</span></div>
      </div>
    </div>
  </div>

  <div class="footer">
    <span>数据源：飞书主播班次表 j69tpS</span>
    <span>生成时间：2026-06-27 18:10 · 爆量君</span>
  </div>
</div>
</body>
</html>"""


# ============================================================
# 方案 B：纯灰阶（无彩色，仅灰阶 + 1 个母版蓝 S 标记）
# ============================================================
HTML_B = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>方案B · 纯灰阶</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #E5E5E5; font-family: -apple-system, "Microsoft YaHei", sans-serif; padding: 20px; }
.slide {
  width: 1280px; height: 720px; margin: 0 auto;
  background: #FAFAFA; padding: 36px 48px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.1);
}
.title h1 { font-size: 22px; font-weight: 700; color: #1A1A1A; letter-spacing: 2px; }
.title .sub { font-size: 11px; color: #888; margin-left: 14px; letter-spacing: 1px; }
.divider { height: 2px; background: #1A1A1A; margin: 14px 0 20px; }

/* KPI */
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); }
.kpi { border-left: 1px solid #D4D4D4; padding: 8px 20px; }
.kpi:first-child { border-left: none; padding-left: 0; }
.kpi .lbl { font-size: 11px; color: #888; }
.kpi .val { font-size: 26px; font-weight: 300; color: #1A1A1A; margin: 4px 0 2px; letter-spacing: -0.5px; }
.kpi .sub { font-size: 10px; color: #999; }

/* Main */
.main { display: grid; grid-template-columns: 1.4fr 1fr; gap: 32px; margin-top: 24px; }
h2 { font-size: 10px; font-weight: 600; color: #888; letter-spacing: 2px; margin-bottom: 10px; text-transform: uppercase; }

table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { font-weight: 400; color: #999; font-size: 10px; padding: 6px 4px; text-align: center; border-bottom: 1px solid #1A1A1A; letter-spacing: 1px; }
td { padding: 9px 4px; text-align: center; border-bottom: 1px solid #EFEFEF; color: #333; }
td.name { font-weight: 600; text-align: left; padding-left: 8px; color: #1A1A1A; }
.tier-s { color: #1A1A1A; font-weight: 700; }
.cpl { font-weight: 600; }
.total td { font-weight: 700; color: #1A1A1A; border-top: 1px solid #1A1A1A; border-bottom: none; }

/* Bar chart - all gray */
.bars .br { display: flex; align-items: center; gap: 8px; margin: 5px 0; font-size: 11px; }
.bars .nm { width: 30px; color: #333; }
.bars .bar { height: 6px; background: #888; }
.bars .bar.top { background: #1A1A1A; }
.bars .vl { color: #666; font-size: 10px; font-family: monospace; }

/* Insights - all gray, no color */
.insight { padding: 6px 0; font-size: 11px; color: #444; border-bottom: 1px dotted #DDD; }
.insight .tg { display: inline-block; font-size: 9px; padding: 1px 6px; background: #1A1A1A; color: #FAFAFA; margin-right: 6px; letter-spacing: 1px; }

.footer { position: absolute; bottom: 14px; left: 48px; right: 48px;
  display: flex; justify-content: space-between; font-size: 9px; color: #AAA; }
</style>
</head>
<body>
<div class="slide">
  <div class="title">
    <h1 style="display:inline">主播能力复盘</h1>
    <span class="sub">2026.06.20—06.26 · 极狐区域号</span>
  </div>
  <div class="divider"></div>

  <div class="kpis">
    <div class="kpi"><div class="lbl">本周总消耗</div><div class="val">¥27.95万</div><div class="sub">日均 ¥3.99万</div></div>
    <div class="kpi"><div class="lbl">总线索量</div><div class="val">2,958</div><div class="sub">CPL ¥95</div></div>
    <div class="kpi"><div class="lbl">班次</div><div class="val">55</div><div class="sub">总时长 110h</div></div>
    <div class="kpi"><div class="lbl">最高消耗/H</div><div class="val">¥3,331</div><div class="sub">小雪(晚高峰)</div></div>
  </div>

  <div class="main">
    <div class="section">
      <h2>主播明细</h2>
      <table>
        <thead>
          <tr><th>梯队</th><th>主播</th><th>班次</th><th>时长</th><th>消耗(元)</th><th>线索</th><th>CPL</th><th>变化</th><th>评价</th></tr>
        </thead>
        <tbody>
__ROWS_B__
          <tr class="total"><td>—</td><td class="name">合计</td><td>55</td><td>110h</td><td>¥279,500</td><td>2,958</td><td>¥95</td><td>—</td><td style="text-align:left">整体水位</td></tr>
        </tbody>
      </table>
    </div>

    <div class="right">
      <div class="section bars">
        <h2>消耗对比 (元)</h2>
__CHART_B__
      </div>

      <div class="section">
        <h2>核心洞察</h2>
        <div class="insight"><span class="tg">亮点</span>芝芝量效双升：CPL −11% / 消耗 +14%</div>
        <div class="insight"><span class="tg">分工</span>早午组(张萌/芝芝/三水)控成本 ¥88–91</div>
        <div class="insight"><span class="tg">风险</span>小雪放量+46% 但 CPL 走高至 ¥108</div>
        <div class="insight"><span class="tg">观察</span>薇薇首秀 ¥3,791/H + CPL ¥99 待观察</div>
      </div>
    </div>
  </div>

  <div class="footer">
    <span>数据源：飞书主播班次表 j69tpS</span>
    <span>生成时间：2026-06-27 18:10 · 爆量君</span>
  </div>
</div>
</body>
</html>"""


# ============================================================
# 方案 C：留白极简（无线框，大量留白，数据驱动）
# ============================================================
HTML_C = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>方案C · 留白极简</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #F5F5F0; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; padding: 20px; }
.slide {
  width: 1280px; height: 720px; margin: 0 auto;
  background: #FFFFFF; padding: 60px 80px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.06);
  position: relative;
}
.title h1 {
  font-size: 28px; font-weight: 300; color: #1A1A1A;
  letter-spacing: 4px;
}
.title h1::before {
  content: ""; display: inline-block; width: 4px; height: 22px;
  background: #1A1A1A; margin-right: 14px; vertical-align: -3px;
}
.title .sub {
  font-size: 11px; color: #999; margin-top: 12px; margin-left: 18px;
  letter-spacing: 2px;
}

/* KPI - large numbers, lots of space */
.kpis {
  display: grid; grid-template-columns: repeat(4, 1fr);
  margin: 50px 0 0; padding: 30px 0;
  border-top: 1px solid #1A1A1A;
}
.kpi { padding: 0 16px; }
.kpi:not(:last-child) { border-right: 1px solid #F0F0F0; }
.kpi .val {
  font-size: 36px; font-weight: 200; color: #1A1A1A;
  letter-spacing: -1px; line-height: 1.1;
}
.kpi .lbl { font-size: 11px; color: #999; margin-top: 6px; letter-spacing: 1px; }

/* Main */
.main {
  display: grid; grid-template-columns: 1.5fr 1fr; gap: 60px;
  margin-top: 40px;
}
h2 { font-size: 10px; font-weight: 400; color: #999; letter-spacing: 4px; margin-bottom: 16px; }

table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { font-weight: 400; color: #BBB; font-size: 9px; padding: 4px; text-align: right; letter-spacing: 1px; }
th:first-child, th:nth-child(2) { text-align: left; }
td { padding: 11px 4px; text-align: right; border-bottom: 1px solid #F5F5F5; color: #333; }
td:first-child, td:nth-child(2) { text-align: left; }
td.name { font-weight: 500; color: #1A1A1A; }
.cpl { font-weight: 500; }
.cpl-best { color: #1A1A1A; font-weight: 600; }
.cpl-warn { color: #999; }

.total td { font-weight: 500; color: #1A1A1A; border-top: 1px solid #1A1A1A; border-bottom: none; padding-top: 14px; }

/* Bar */
.bars { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
.bar-r { display: grid; grid-template-columns: 32px 1fr 60px; align-items: center; gap: 10px; font-size: 11px; }
.bar-r .nm { color: #333; }
.bar-r .bar-bg { height: 4px; background: #F0F0F0; }
.bar-r .bar-fg { height: 100%; background: #1A1A1A; }
.bar-r .vl { color: #999; font-size: 10px; text-align: right; font-family: monospace; }

.insights { margin-top: 30px; }
.ins { display: flex; gap: 12px; font-size: 11px; padding: 10px 0; border-bottom: 1px solid #F5F5F5; }
.ins:last-child { border-bottom: none; }
.ins .tg { color: #1A1A1A; font-weight: 500; min-width: 48px; }
.ins .txt { color: #666; }

.footer { position: absolute; bottom: 20px; left: 80px; right: 80px;
  display: flex; justify-content: space-between; font-size: 9px; color: #BBB; letter-spacing: 1px; }
</style>
</head>
<body>
<div class="slide">
  <div class="title">
    <h1>主播能力复盘</h1>
    <div class="sub">2026.06.20—06.26 · 极狐区域号</div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="val">¥27.95<span style="font-size:14px;color:#999">万</span></div><div class="lbl">本周总消耗</div></div>
    <div class="kpi"><div class="val">2,958</div><div class="lbl">总线索量</div></div>
    <div class="kpi"><div class="val">55</div><div class="lbl">班次 · 110h</div></div>
    <div class="kpi"><div class="val">¥3,331</div><div class="lbl">最高消耗/H</div></div>
  </div>

  <div class="main">
    <div class="section">
      <h2>主播明细</h2>
      <table>
        <thead>
          <tr>
            <th>主播</th><th>梯队</th><th>班次</th><th>时长</th>
            <th>消耗(元)</th><th>线索</th><th>CPL</th><th>变化</th><th style="text-align:left">评价</th>
          </tr>
        </thead>
        <tbody>
__ROWS_C__
          <tr class="total"><td class="name">合计</td><td>—</td><td>55</td><td>110h</td><td>¥279,500</td><td>2,958</td><td>¥95</td><td>—</td><td>整体水位</td></tr>
        </tbody>
      </table>
    </div>

    <div class="right">
      <div class="section">
        <h2>消耗对比 (元)</h2>
        <div class="bars">
__CHART_C__
        </div>
      </div>

      <div class="section insights">
        <h2>核心洞察</h2>
        <div class="ins"><span class="tg">亮点</span><span class="txt">芝芝量效双升：CPL −11% / 消耗 +14%</span></div>
        <div class="ins"><span class="tg">分工</span><span class="txt">早午组(张萌/芝芝/三水)控成本 ¥88–91</span></div>
        <div class="ins"><span class="tg">风险</span><span class="txt">小雪放量+46% 但 CPL 走高至 ¥108</span></div>
        <div class="ins"><span class="tg">观察</span><span class="txt">薇薇首秀 ¥3,791/H + CPL ¥99 待观察</span></div>
      </div>
    </div>
  </div>

  <div class="footer">
    <span>数据源：飞书主播班次表 j69tpS</span>
    <span>2026-06-27 · 爆量君</span>
  </div>
</div>
</body>
</html>"""


# ====== 数据渲染 ======
def render_rows_a():
    """方案A：表格行 - 浅灰底+母版蓝点缀"""
    rows = []
    for a in ANCHORS:
        cpl_cls = "cpl-good" if a["cpl"] <= 90 else "cpl-warn" if a["cpl"] <= 100 else "cpl-bad"
        chg_cls = "down" if a["chg"].startswith("−") or a["chg"] == "持平" else ("up" if a["chg"].startswith("+") else "")
        chg_cell = a["chg"]
        if chg_cell.startswith("+") and chg_cell != "首秀": chg_cell = f'<span class="up">{chg_cell}</span>'
        elif chg_cell.startswith("−"): chg_cell = f'<span class="down">{chg_cell}</span>'
        rows.append(
            f'<tr><td><span class="tier">{a["tier"]}</span></td>'
            f'<td class="name">{a["name"]}</td>'
            f'<td>{a["slot"]}</td><td>{a["hour"]}h</td>'
            f'<td>{a["spend"]:,}</td><td>{a["lead"]}</td>'
            f'<td class="{cpl_cls}">¥{a["cpl"]}</td>'
            f'<td>{chg_cell}</td>'
            f'<td style="text-align:left;color:#6B7280">{a["note"]}</td></tr>'
        )
    return "\n          ".join(rows)

def render_chart_a():
    max_v = max(a["spend"] for a in ANCHORS)
    parts = []
    for a in ANCHORS:
        w = int(a["spend"] / max_v * 100)
        bar_cls = "" if a["cpl"] <= 90 else "warn" if a["cpl"] <= 100 else "bad"
        parts.append(
            f'<div class="bar-row"><span class="nm">{a["name"]}</span>'
            f'<div class="bar {bar_cls}" style="width: {w}%"></div>'
            f'<span class="vl">¥{a["spend"]//1000}k</span></div>'
        )
    return "\n        ".join(parts)

def render_rows_b():
    rows = []
    for a in ANCHORS:
        cpl_cls = "" if a["cpl"] <= 90 else "style=\"color:#888\""
        tier_cls = "tier-s" if a["tier"] == "S" else ""
        rows.append(
            f'<tr><td class="{tier_cls}">{a["tier"]}</td>'
            f'<td class="name">{a["name"]}</td>'
            f'<td>{a["slot"]}</td><td>{a["hour"]}h</td>'
            f'<td>{a["spend"]:,}</td><td>{a["lead"]}</td>'
            f'<td class="cpl" {cpl_cls}>¥{a["cpl"]}</td>'
            f'<td>{a["chg"]}</td>'
            f'<td style="text-align:left;color:#666">{a["note"]}</td></tr>'
        )
    return "\n          ".join(rows)

def render_chart_b():
    max_v = max(a["spend"] for a in ANCHORS)
    parts = []
    for i, a in enumerate(ANCHORS):
        w = int(a["spend"] / max_v * 100)
        top_cls = "top" if i == 0 else ""
        parts.append(
            f'<div class="br"><span class="nm">{a["name"]}</span>'
            f'<div class="bar {top_cls}" style="width: {w}%"></div>'
            f'<span class="vl">¥{a["spend"]//1000}k</span></div>'
        )
    return "\n        ".join(parts)

def render_rows_c():
    rows = []
    for a in ANCHORS:
        cpl_cls = "cpl-best" if a["cpl"] <= 90 else "cpl-warn"
        rows.append(
            f'<tr><td class="name">{a["name"]}</td>'
            f'<td>{a["tier"]}</td>'
            f'<td>{a["slot"]}</td><td>{a["hour"]}h</td>'
            f'<td>{a["spend"]:,}</td><td>{a["lead"]}</td>'
            f'<td class="cpl {cpl_cls}">¥{a["cpl"]}</td>'
            f'<td>{a["chg"]}</td>'
            f'<td>{a["note"]}</td></tr>'
        )
    return "\n          ".join(rows)

def render_chart_c():
    max_v = max(a["spend"] for a in ANCHORS)
    parts = []
    for a in ANCHORS:
        w = int(a["spend"] / max_v * 100)
        parts.append(
            f'<div class="bar-r">'
            f'<span class="nm">{a["name"]}</span>'
            f'<div class="bar-bg"><div class="bar-fg" style="width:{w}%"></div></div>'
            f'<span class="vl">¥{a["spend"]//1000}k</span></div>'
        )
    return "\n          ".join(parts)

# 填充模板
html_a = HTML_A.replace("__ROWS_A__", render_rows_a()).replace("__CHART_A__", render_chart_a())
html_b = HTML_B.replace("__ROWS_B__", render_rows_b()).replace("__CHART_B__", render_chart_b())
html_c = HTML_C.replace("__ROWS_C__", render_rows_c()).replace("__CHART_C__", render_chart_c())

with open(OUT_DIR / "PPT方案A_极简白底.html", "w", encoding="utf-8") as f:
    f.write(html_a)
with open(OUT_DIR / "PPT方案B_纯灰阶.html", "w", encoding="utf-8") as f:
    f.write(html_b)
with open(OUT_DIR / "PPT方案C_留白极简.html", "w", encoding="utf-8") as f:
    f.write(html_c)

print("✓ 方案A_极简白底.html")
print("✓ 方案B_纯灰阶.html")
print("✓ 方案C_留白极简.html")
