// src/domain/report-html-style.mjs - 离线报表样式

export const REPORT_HTML_STYLE = `<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f7fa;color:#2c3e50;padding:20px}
.header{background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);color:#fff;padding:28px 36px;border-radius:14px;margin-bottom:22px}
.header h1{font-size:26px;margin-bottom:4px;letter-spacing:1px}
.header .sub{color:#a0aec0;font-size:13px;margin-top:6px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:22px}
.card{background:#fff;border-radius:10px;padding:18px 16px;box-shadow:0 2px 12px rgba(0,0,0,.06);transition:transform .15s}
.card:hover{transform:translateY(-2px)}
.card .label{font-size:11px;color:#95a5a6;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.card .value{font-size:24px;font-weight:700}
.card .subv{font-size:12px;color:#95a5a6;margin-top:4px}
.green{color:#27ae60}.red{color:#e74c3c}.blue{color:#2980b9}.orange{color:#e67e22}
.section{background:#fff;border-radius:10px;padding:22px 24px;margin-bottom:20px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
.section h2{font-size:17px;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #ecf0f1;display:flex;align-items:center;gap:8px}
.section h2 .count{font-size:12px;color:#94a3b8;font-weight:400}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{background:#f8fafc;padding:10px 8px;text-align:left;font-weight:600;border-bottom:2px solid #e2e8f0;white-space:nowrap;color:#64748b;font-size:11px}
td{padding:8px;border-bottom:1px solid #f1f5f9}
tr:hover{background:#f8faff}
.footer{text-align:center;color:#94a3b8;font-size:11px;margin-top:24px;padding:16px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600}
.bg-green{background:#dcfce7;color:#166534}.bg-red{background:#fee2e2;color:#991b1b}.bg-yellow{background:#fef9c3;color:#854d0e}.bg-blue{background:#dbeafe;color:#1e40af}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
.pulse{animation:pulse 2s infinite}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:768px){.grid2{grid-template-columns:1fr}}
.scroll-table{max-height:500px;overflow-y:auto}
</style>`;
