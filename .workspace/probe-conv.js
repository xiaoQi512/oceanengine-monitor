const WebSocket = require('ws');
const http = require('http');
http.get('http://127.0.0.1:9222/json', (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const pages = JSON.parse(data);
    const target = pages.find(p => p.type === 'page' && p.title.includes('投放'));
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{expression:`
(function(){
  var rows = document.querySelectorAll('tbody tr');
  var sum9 = 0, count = 0, samples = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.classList.contains('ovui-t-summary')) continue;
    var cells = r.querySelectorAll('td');
    if (cells.length < 10) continue;
    count++;
    var conv = parseInt((cells[9]?.textContent?.trim() || '0').replace(/,/g, '')) || 0;
    sum9 += conv;
    if (conv > 0) samples.push(cells[1]?.textContent?.trim().substring(0,15) + ' cv=' + conv);
  }
  return 'rows=' + rows.length + ' valid=' + count + ' sum=' + sum9 + ' | ' + samples.join(', ');
})()
      `}}));
    });
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id === 1) { console.log(msg.result?.result?.value); ws.close(); process.exit(0); }
    });
  });
});
