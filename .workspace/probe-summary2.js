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
  var cells = document.querySelectorAll('.ovui-t-summary-cell');
  var vals = Array.from(cells).map(function(c,i) {
    return i + ':' + (c.textContent?.trim() || '-').substring(0,20);
  });
  return 'count=' + cells.length + ' | ' + vals.join(', ');
})()
      `}}));
    });
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id === 1) { console.log(msg.result?.result?.value); ws.close(); process.exit(0); }
    });
  });
});
