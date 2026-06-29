const WebSocket = require('ws');
const http = require('http');
http.get('http://127.0.0.1:9222/json', (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const pages = JSON.parse(d);
    const t = pages.find(p => p.type === 'page' && p.title.includes('投放'));
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{expression:`
(function(){
  var sr = document.querySelectorAll('tr.ovui-t-summary');
  var r = {count: sr.length};
  if (sr[0]) {
    var cells = sr[0].querySelectorAll('td');
    r.cellCount = cells.length;
    r.spend = cells[7]?.textContent?.trim();
    r.conv = cells[9]?.textContent?.trim();
    r.leads = cells[8]?.textContent?.trim();
  }
  // Also check for data-summary attribute
  var dsr = document.querySelectorAll('[class*=summary], [class*=total], [class*=footer]');
  r.summaryEls = Array.from(dsr).slice(0,5).map(e => e.className.substring(0,30) + ' txt=' + e.textContent.trim().substring(0,40));
  return JSON.stringify(r);
})()
      `}}));
    });
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id === 1) { console.log(msg.result?.result?.value); ws.close(); process.exit(0); }
    });
  });
});
