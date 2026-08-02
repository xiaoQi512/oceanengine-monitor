// src/domain/daily-report-html-style.mjs - 日报 HTML 样式

export const DAILY_REPORT_HTML_STYLE = `<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f7fa;color:#2c3e50;padding:20px;max-width:1200px;margin:0 auto}
.header{background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);color:#fff;padding:32px 40px;border-radius:14px;margin-bottom:24px}
.header h1{font-size:28px;margin-bottom:6px;letter-spacing:1px}
.header .sub{color:#a0aec0;font-size:14px;margin-top:8px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:24px}
.card{background:#fff;border-radius:10px;padding:20px 18px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
.card .label{font-size:11px;color:#95a5a6;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.card .value{font-size:26px;font-weight:700}
.card .subv{font-size:12px;color:#95a5a6;margin-top:4px}
.green{color:#27ae60}.red{color:#e74c3c}.blue{color:#2980b9}.orange{color:#e67e22}
.section{background:#fff;border-radius:10px;padding:24px 28px;margin-bottom:20px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
.section h2{font-size:18px;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #ecf0f1}
.chart-row{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}
.chart-container{position:relative;height:300px}
.chart-container canvas{width:100%!important;height:100%!important}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#f8fafc;padding:10px 8px;text-align:left;font-weight:600;border-bottom:2px solid #e2e8f0;white-space:nowrap;color:#64748b}
td{padding:8px;border-bottom:1px solid #f1f5f9}
tr:hover{background:#f8faff}
.footer{text-align:center;color:#94a3b8;font-size:12px;margin-top:32px;padding:20px}
@media(max-width:768px){.chart-row{grid-template-columns:1fr}}
</style>`;
