// src/services/five-min-cdp-fallback.mjs - 5min CDP 降级采集

export async function cdpFallback() {
  console.log('  🔄 降级到 CDP...');
  const { quickConnect } = await import('../cdp/client.mjs');
  const { sleep, waitForToolbar, waitForPageReady } = await import('../utils/wait-utils.mjs');
  const { calibratePage } = await import('../cdp/calibrate-page.mjs');

  const connResult = await quickConnect({ cmdTimeout: 15000, heartbeatInterval: 60000 });
  if (!connResult) {
    console.log('  ❌ CDP连接失败');
    return null;
  }
  const { client } = connResult;
  try {
    await client.evalJs('location.reload(true)');
    await sleep(4000);
    await waitForPageReady(client, 10000);
    await calibratePage(client, { dateRetries: 2, searchRetries: 1, statusRetries: 1, sortRetries: 1 });
    await waitForToolbar(client, 8000);
    const dataStr = await client.evalJs('(function(){let a=0,b=0,c=0;var t=document.querySelector(".oc-promotion-tool-bar");if(t){var k=t.querySelectorAll(".oc-promotion-tool-bar-key-value");for(var i=0;i<k.length;i++){var s=k[i].querySelectorAll("span");var l=s[0]?s[0].textContent.trim():"";var v=s[3]?s[3].textContent.trim():"";var n=parseFloat(v.replace(/,/g,""))||0;if(l.indexOf("日消耗")>=0)a=n;else if(l.indexOf("日预算")>=0)b=n;else if(l.indexOf("账户余额")>=0)c=n}}return JSON.stringify({accountSpend:a,accountBudget:b,accountBalance:c,time:new Date().toISOString()})})()');
    const parsed = JSON.parse(dataStr || '{}');
    const tableDataStr = await client.evalJs('(function(){let totalConv=0,activeCount=0;try{var sr=document.querySelector("tr.ovui-t-summary");if(sr){var sc=sr.querySelectorAll("th,td");totalConv=parseInt((sc[9]?.textContent||"0").replace(/,/g,""))||0}}catch(e){}try{var rows=document.querySelectorAll("tbody tr");for(var i=0;i<rows.length;i++){var cells=rows[i].querySelectorAll("td");if(cells.length<10)continue;var status=(cells[4]?.textContent||"").trim();if(status.indexOf("投放中")>=0||status.indexOf("启用中")>=0||status==="启用")activeCount++}}catch(e){}return JSON.stringify({totalConv:totalConv,activeCount:activeCount})})()');
    const tableParsed = JSON.parse(tableDataStr || '{}');
    const data = {
      ...parsed,
      summarySpend: parsed.accountSpend,
      totalConv: tableParsed.totalConv || 0,
      activeCount: tableParsed.activeCount || 0,
      spendingCount: 0,
      impressions: 0,
      liveViews: 0,
      liveOver1Min: 0,
      _method: 'cdp',
    };
    console.log(`  ✅ CDP: 消耗 ¥${parsed.accountSpend?.toFixed(0) || 0} | 转化 ${data.totalConv} | 投放中 ${data.activeCount}`);
    return data;
  } finally {
    client.close();
  }
}
