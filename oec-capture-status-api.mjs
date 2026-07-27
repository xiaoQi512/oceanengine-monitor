// oec-capture-status-api.mjs — 注入XHR拦截器 + 程序化点击开关 → 捕获暂停/启动API
import { getOceanEngineTab } from './cdp-client.mjs';
import WebSocket from 'ws';
import { sleep } from './wait-utils.mjs';

async function capture() {
  console.log('🔍 逆向巨量引擎 暂停/启动 API\n');

  const tab = await getOceanEngineTab(['投放管理', '巨量引擎工作台']);
  if (!tab) { console.log('❌ 未找到标签页'); process.exit(1); }
  console.log(`📄 ${tab.title}`);

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let cmdId = 2;
  const pending = new Map();
  const capturedRequests = [];

  function wsSend(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = cmdId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, 15000);
    });
  }

  ws.on('message', (data) => {
    const d = Buffer.isBuffer(data) ? data.toString() : String(data || '');
    let msg;
    try { msg = JSON.parse(d); } catch { return; }

    // 监听 Network 请求
    if (msg.method === 'Network.requestWillBeSent') {
      const req = msg.params.request;
      const url = req.url || '';
      if (url.includes('ad.oceanengine.com') && req.method === 'POST') {
        capturedRequests.push({
          requestId: msg.params.requestId,
          method: req.method,
          url: url.substring(0, 200),
          postData: (msg.params.request?.postData || '').substring(0, 3000),
          timestamp: new Date().toISOString(),
        });
        console.log(`\n📡 ${req.method} ${url.substring(0, 120)}`);
        if (msg.params.request?.postData) {
          try {
            const pd = msg.params.request.postData.substring(0, 1500);
            console.log(`   Body: ${pd}`);
          } catch {}
        }
      }
    }

    // 响应捕获
    if (msg.method === 'Network.responseReceived') {
      const resp = msg.params.response;
      const url = resp.url || '';
      for (const c of capturedRequests) {
        if (c.requestId === msg.params.requestId) {
          c.status = resp.status;
          break;
        }
      }
    }

    // XHR 拦截器报告（来自前端注入）
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
      if (args.includes('[XHR-INTERCEPT]')) {
        console.log(args);
      }
    }

    // 命令响应
    if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 10000);
  });

  console.log('✅ CDP 已连接\n');

  // 1. 启用 Network 域
  await wsSend('Page.enable');
  await wsSend('Runtime.enable');
  await wsSend('Network.enable', {
    maxTotalBufferSize: 100000000,
    maxResourceBufferSize: 50000000,
  });
  await sleep(500);

  // 2. 注入 XHR 拦截器（双重保险）
  console.log('🔧 注入 XHR 拦截器...');
  await wsSend('Runtime.evaluate', {
    expression: `
      (function() {
        const origFetch = window.fetch;
        window.fetch = function(...args) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
          if (url && args[1]?.method === 'POST') {
            console.log('[XHR-INTERCEPT] FETCH POST: ' + url.substring(0, 120));
            if (args[1]?.body) {
              try { console.log('[XHR-INTERCEPT] Body: ' + 
                (typeof args[1].body === 'string' ? args[1].body : JSON.stringify(args[1].body)).substring(0, 800)); } catch {}
            }
          }
          return origFetch.apply(this, args);
        };

        const origXHR = window.XMLHttpRequest;
        const origOpen = origXHR.prototype.open;
        const origSend = origXHR.prototype.send;
        origXHR.prototype.open = function(method, url) {
          this._url = url;
          this._method = method;
          return origOpen.apply(this, arguments);
        };
        origXHR.prototype.send = function(body) {
          if (this._method === 'POST' && this._url?.includes('oceanengine.com')) {
            console.log('[XHR-INTERCEPT] XHR POST: ' + this._url.substring(0, 120));
            if (body) {
              try { console.log('[XHR-INTERCEPT] Body: ' + (typeof body === 'string' ? body : JSON.stringify(body)).substring(0, 800)); } catch {}
            }
          }
          return origSend.apply(this, arguments);
        };
        console.log('[XHR-INTERCEPT] Interceptor installed');
      })()
    `,
  });
  await sleep(300);
  console.log('✅ XHR 拦截器已注入\n');

  // 3. 导航到无过滤器的投放管理页
  console.log('🔄 加载无过滤器的投放管理页面...');
  const campaignUrl = 'https://ad.oceanengine.com/promotion/promote-manage/project?aadvid=1842681352509635';
  await wsSend('Page.navigate', { url: campaignUrl });
  
  // 等待页面加载完成
  console.log('⏳ 等待页面加载 (15s)...');
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    // 检查项目列表是否已加载
    const check = await wsSend('Runtime.evaluate', {
      expression: `document.querySelectorAll('table tbody tr').length > 0 && document.querySelectorAll('[role="switch"]').length > 0`,
      returnByValue: true,
    });
    if (check?.result?.result?.value === true) {
      console.log(`   ✅ 页面已就绪 (${i + 1}s)`);
      break;
    }
    if (i % 5 === 4) process.stdout.write(`   ${i + 1}s...`);
  }
  console.log();

  // 4. 检查 toggle 开关状态
  const switchCheck = await wsSend('Runtime.evaluate', {
    expression: `JSON.stringify({
      switchCount: document.querySelectorAll('[role="switch"]').length,
      projectRows: document.querySelectorAll('table tbody tr').length,
    })`,
    returnByValue: true,
  });
  console.log('   页面状态:', switchCheck?.result?.result?.value || '未知');

  // 5. 程序化点击 toggle 开关
  console.log('\n🖱 使用 CDP Input 域真实点击开关...\n');

  const beforeCount = capturedRequests.length;

  // 获取开关位置
  const switchInfo = await wsSend('Runtime.evaluate', {
    expression: `
      (() => {
        const sw = document.querySelector('[role="switch"]');
        if (!sw) return 'null';
        const rect = sw.getBoundingClientRect();
        return JSON.stringify({
          found: true,
          checked: sw.getAttribute('aria-checked'),
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          text: sw.closest('tr')?.querySelector('td')?.textContent?.substring(0, 50) || '',
        });
      })()
    `,
    returnByValue: true,
  });

  const info = JSON.parse(switchInfo?.result?.result?.value || 'null');
  if (!info || info === 'null') {
    console.log('   ❌ 未找到 toggle 开关');
  } else {
    console.log(`   找到: ${info.text}, 状态=${info.checked}, 位置=(${info.x},${info.y})`);

    await wsSend('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
    await wsSend('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
    console.log('   👆 已执行点击');
    await sleep(2000);

    // 处理确认弹窗
    await wsSend('Runtime.evaluate', {
      expression: `(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) { if (b.textContent.includes('确定')||b.textContent.includes('确认')) { b.click(); return b.textContent; } }
        return '无弹窗';
      })()`,
      returnByValue: true,
    }).then(r => console.log('   弹窗:', r?.result?.result?.value || ''));

    await sleep(3000);
  }

  const newReqs = capturedRequests.slice(beforeCount);
  if (newReqs.length > 0) {
    console.log(`\n✅ 捕获到 ${newReqs.length} 个新请求:`);
    for (const req of newReqs) {
      const isStatus = (req.postData || '').includes('status') || (req.url || '').includes('update') || (req.url || '').includes('operate');
      console.log(`\n${isStatus ? '🎯' : '  '} URL: ${req.url}`);
      console.log(`   Body: ${req.postData}`);
    }
  }

  // 5. 输出结果
  console.log(`\n📊 共捕获 ${capturedRequests.length} 个 POST 请求`);

  // 打印所有含 request body 的新请求
  const withBody = capturedRequests.filter(r => r.postData);
  console.log(`\n所有含 Body 的请求 (${withBody.length} 个):`);
  for (const r of withBody) {
    console.log(`\n---`);
    console.log(`URL: ${r.url}`);
    console.log(`Body: ${r.postData}`);
    console.log(`Status: ${r.status || '?'}`);
  }

  ws.close();
}

capture().catch(e => {
  console.error('❌', e.message);
  process.exit(1);
});
