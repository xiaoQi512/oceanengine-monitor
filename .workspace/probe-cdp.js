const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const pages = JSON.parse(data);
    const target = pages.find(p => p.type === 'page' && (p.title.includes('投放')||p.title.includes('巨量')));
    if (!target) { console.log('No page'); return; }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.on('open', () => {
      const expr = `
        (function(){
          var r = {};
          r.allTbody = document.querySelectorAll("tbody").length;
          r.tbodyRows = document.querySelectorAll("tbody tr").length;
          r.tableClass = document.querySelectorAll("[class*=table]").length;
          r.rowClass = document.querySelectorAll("[class*=row]").length;
          r.ovuiAll = document.querySelectorAll("[class*=ovui]").length;
          // Find the main table structure
          var tables = document.querySelectorAll("table");
          r.tableCount = tables.length;
          var mainTable = tables[0];
          if (mainTable) {
            var tbody = mainTable.querySelector("tbody");
            r.hasTbody = !!tbody;
            if (tbody) {
              var rows = tbody.querySelectorAll("tr");
              r.rowCount = rows.length;
              // Get first row classes and structure
              if (rows[0]) { r.firstRowClass = rows[0].className; r.firstRowHTML = rows[0].outerHTML.substring(0, 500); }
            }
            // Get thead cells
            var thead = mainTable.querySelector("thead");
            if (thead) {
              var headers = thead.querySelectorAll("th");
              r.headerCount = headers.length;
              r.headerTexts = Array.from(headers).map(h => h.textContent.trim()).join(" | ");
            }
          }
          // Check for lazy-load / infinite scroll
          r.bodyChildren = document.body.children.length;
          r.rootDivId = document.getElementById("root") ? "has-root" : "no-root";
          return JSON.stringify(r);
        })()
      `;
      ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{expression:expr}}));
    });
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id === 1) {
        console.log(msg.result?.result?.value || 'err');
        ws.close(); process.exit(0);
      }
    });
    setTimeout(() => { console.log('Timeout'); process.exit(1); }, 10000);
  });
});
