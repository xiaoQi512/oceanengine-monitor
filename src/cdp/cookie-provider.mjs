// src/cdp/cookie-provider.mjs - 巨量引擎浏览器 Cookie 提取（由 services 注入 platform）
import fs from 'node:fs';
import { WebSocket } from 'ws';
import { getOceanEngineTab } from './client.mjs';
import { ACCOUNT_ID } from '../config/index.mjs';
import { OEC_BASE_URL, OEC_COOKIE_CACHE_FILE } from '../platform/oec-client.mjs';

const COOKIE_CACHE_TTL = 2 * 60 * 60 * 1000; // Cookie 缓存2小时 (实测session约2h)

export async function extractCookiesFromBrowser() {
  console.log('  🍪 从浏览器提取 Cookie...');

  const tab = await getOceanEngineTab(['投放管理', '巨量引擎工作台']);

  // 浏览器未登录 → 尝试自动登录
  if (!tab) {
    const email = process.env.OEC_EMAIL || '';
    const password = process.env.OEC_PASSWORD || '';
    if (email && password) {
      console.log('  ⚠ 无巨量引擎标签页，触发自动登录...');
      const { autoLogin } = await import('./auto-login.mjs');
      const result = await autoLogin(email, password);
      if (result.success) {
        try {
          if (fs.existsSync(OEC_COOKIE_CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(OEC_COOKIE_CACHE_FILE, 'utf-8'));
          }
        } catch {}
      }
      if (result.captcha) throw new Error('CAPTCHA_REQUIRED: 需要人工完成验证码');
    }
    throw new Error('未找到巨量引擎标签页且无法自动登录');
  }

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let cmdId = 1;
  const pending = new Map();

  function wsSend(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = cmdId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); }
      }, 10000);
    });
  }

  await new Promise((r, rej) => { ws.once('open', r); ws.once('error', rej); setTimeout(() => rej(new Error('ws timeout')), 8000); });
  ws.on('message', (data) => {
    const d = Buffer.isBuffer(data) ? data.toString() : String(data || '');
    let msg; try { msg = JSON.parse(d); } catch { return; }
    if (msg.id && pending.has(msg.id)) { const { resolve } = pending.get(msg.id); pending.delete(msg.id); resolve(msg); }
  });

  await wsSend('Network.enable');

  const result = await wsSend('Network.getCookies', {
    urls: ['https://ad.oceanengine.com', 'https://sso.oceanengine.com'],
  });
  const cookies = result?.result?.cookies || [];
  // URI编码cookie值，确保HTTP头仅含ASCII安全字符（如get_new_msg_timer_cycle含中文）
  const cookieString = cookies.map(c => `${c.name}=${encodeURIComponent(c.value)}`).join('; ');

  const uaResult = await wsSend('Runtime.evaluate', {
    expression: 'navigator.userAgent', returnByValue: true,
  });
  ws.close();

  const userAgent = uaResult?.result?.result?.value || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  const headers = {
    'Cookie': cookieString,
    'User-Agent': userAgent,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': `${OEC_BASE_URL}/promotion/promote-manage/project?aadvid=${ACCOUNT_ID}`,
    'Origin': OEC_BASE_URL,
    'Content-Type': 'application/json',
  };

  const cookieData = { cookies: cookieString, headers, expireAt: Date.now() + COOKIE_CACHE_TTL };
  fs.writeFileSync(OEC_COOKIE_CACHE_FILE, JSON.stringify(cookieData, null, 2));

  console.log(`  ✅ 提取 ${cookies.length} 个 Cookie (有效期至 ${new Date(cookieData.expireAt).toLocaleString()})`);
  return cookieData;
}
