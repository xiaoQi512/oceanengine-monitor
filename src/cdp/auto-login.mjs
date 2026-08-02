// oec-auto-login.mjs — 巨量引擎 SSO 自动登录模块
// Cookie 过期时通过 CDP 自动填写账号密码登录
// 遇到验证码时发送飞书通知请求人工协助
//
// 用法:
//   import { autoLogin } from './oec-auto-login.mjs'
//   const success = await autoLogin('pq-wanghui@bjev.com.cn', 'JHqyh2026')
//   // 成功 → Cookie自动缓存到 monitor-data/.oec-cookies.json

import fs from 'node:fs';
import path from 'node:path';
import { createCDPClient, getOceanEngineTab, checkCDP } from './client.mjs';
import { sleep } from '../utils/wait-utils.mjs';
import { DATA_DIR, CAMPAIGN_URL, CDP_PORT, FEISHU_CHAT_ID } from '../config/index.mjs';
import { findLarkCli } from '../utils/monitor-utils.mjs';

const COOKIE_CACHE_FILE = path.join(DATA_DIR, '.oec-cookies.json');
const SSO_LOGIN_URL = 'https://sso.oceanengine.com/login/';
const SSO_LOGIN_URL_ALT = 'https://ad.oceanengine.com/pages/login/index.html';

// ====== CDP 鼠标点击辅助 ======
async function cdpClick(client, x, y) {
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(80);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(50);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(1500);
}

// ====== 飞书通知 ======
async function notifyUser(title, body) {
  try {
    const larkCli = findLarkCli();
    if (!larkCli) { console.log('  ⚠ lark-cli 未配置'); return; }
    const { spawnSync } = await import('node:child_process');
    spawnSync('bash', ['-c', `${larkCli} im +messages-send --chat-id ${FEISHU_CHAT_ID} --text "🤖 ${title}\\n${body}"`], { timeout: 10000 });
  } catch {}
}

// ====== Cookie提取 ======
async function extractAndCacheCookies(client) {
  const result = await client.send('Network.getCookies', {
    urls: ['https://ad.oceanengine.com', 'https://sso.oceanengine.com', 'https://business.oceanengine.com'],
  });

  const cookies = result?.result?.cookies || [];
  if (cookies.length === 0) return null;

  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  const ua = await client.evalJs('navigator.userAgent') || 'Mozilla/5.0';

  const cookieData = {
    cookies: cookieString,
    headers: {
      'Cookie': cookieString,
      'User-Agent': ua,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': `${CAMPAIGN_URL}`,
      'Origin': 'https://ad.oceanengine.com',
      'Content-Type': 'application/json',
    },
    expireAt: Date.now() + 2 * 60 * 60 * 1000,
    loginTime: new Date().toISOString(),
  };

  fs.writeFileSync(COOKIE_CACHE_FILE, JSON.stringify(cookieData, null, 2));
  console.log(`  ✅ ${cookies.length}个Cookie已缓存 (2h有效)`);
  return cookieData;
}

// ====== 主登录流程 ======

/**
 * 自动登录巨量引擎
 * @param {string} email - 账号邮箱
 * @param {string} password - 密码
 * @returns {Promise<{success: boolean, error?: string, captcha?: boolean, action?: string}>}
 */
export async function autoLogin(email, password) {
  console.log('🔐 开始自动登录...');
  const start = Date.now();

  // 0. 检查 CDP 可用性
  const cdpStatus = await checkCDP();
  if (!cdpStatus.reachable) {
    console.log('  ❌ Chrome CDP 不可达，无法登录');
    await notifyUser('⚠️ 自动登录失败', 'Chrome浏览器未运行，Cookie过期后将无法采集数据');
    return { success: false, error: 'cdp_unreachable' };
  }

  // 找可用标签页（优先巨量引擎，否则用任意页面）
  let tab = await getOceanEngineTab(['投放管理', '巨量引擎工作台']);
  if (!tab) {
    // 找任意标签页
    try {
      const resp = await fetch(`http://localhost:${CDP_PORT}/json/list`);
      const tabs = await resp.json();
      tab = tabs.find(t => t.type === 'page') || tabs[0];
    } catch {}
  }

  // 新建标签页（如果当前标签页被占用）
  if (!tab) {
    // 通过 /json/new 创建新标签
    try {
      const resp = await fetch(`http://localhost:${CDP_PORT}/json/new?` + encodeURIComponent('about:blank'));
      tab = await resp.json();
    } catch {}
  }

  if (!tab) {
    console.log('  ❌ 无可用标签页');
    return { success: false, error: 'no_tab' };
  }

  console.log(`  📄 使用标签: ${tab.title?.substring(0, 40)}`);

  let client;
  try {
    client = await createCDPClient(tab.webSocketDebuggerUrl, { cmdTimeout: 20000, heartbeatInterval: 60000 });
  } catch (e) {
    console.log(`  ❌ CDP 连接失败: ${e.message}`);
    return { success: false, error: 'connect_failed' };
  }

  try {
    // 1. 清除 Cookie + 导航到登录页
    await client.call('Network.enable');
    await client.call('Network.clearBrowserCookies');
    console.log('  🧹 Cookie已清除');

    await client.call('Page.navigate', { url: SSO_LOGIN_URL });
    await sleep(5000);

    let url = await client.evalJs('location.href') || '';

    // 如果自动跳转到工作台，说明已有其他登录态
    if (url.includes('business.oceanengine.com') || url.includes('ad.oceanengine.com/promotion')) {
      console.log('  ℹ 已登录，直接提取Cookie');
      await extractAndCacheCookies(client);
      return { success: true, action: 'already_logged_in' };
    }

    // 2. 切换到"账密登录"
    console.log('  🔘 切换到账密登录...');

    // 获取"账密登录"标签坐标
    const tabCoords = await client.evalJs(`
      JSON.stringify((() => {
        for (const el of document.querySelectorAll('*')) {
          if (el.textContent?.trim() === '账密登录' && el.offsetParent) {
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width/2, y: r.y + r.height/2 };
          }
        }
        return null;
      })())
    `);

    if (tabCoords && tabCoords !== 'null') {
      const coords = JSON.parse(tabCoords);
      await cdpClick(client, coords.x, coords.y);
      await sleep(2000);
    } else {
      console.log('  ⚠ 未找到"账密登录"选项卡');
    }

    // 3. 填写邮箱和密码（用原生 setter + 事件触发 Vue）
    console.log('  ✏️ 填写账号密码...');
    const fillResult = await client.evalJs(`
      (() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const inputs = Array.from(document.querySelectorAll('input')).filter(inp => inp.offsetParent);
        let result = [];

        for (const inp of inputs) {
          const ph = (inp.placeholder || '').trim();
          if (ph.includes('手机号') || ph.includes('邮箱') || ph.includes('账号')) {
            setter.call(inp, '${email.replace(/'/g, "\\'")}');
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('blur', { bubbles: true }));
            result.push('account_filled');
          }
          if (ph.includes('密码')) {
            setter.call(inp, '${password.replace(/'/g, "\\'")}');
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('blur', { bubbles: true }));
            result.push('password_filled');
          }
        }

        // 勾选"同意协议"（如果存在）
        const checkbox = document.querySelector('input[type="checkbox"]');
        if (checkbox && !checkbox.checked) {
          checkbox.click();
          result.push('terms_checked');
        }

        return result.join(',') || 'nothing_filled';
      })()
    `);
    console.log(`    结果: ${fillResult}`);

    await sleep(1000);

    // 4. 检查是否有CAPTCHA（填充账号后可能出现）
    let captchaDetected = await client.evalJs(`
      JSON.stringify({
        captcha: !!document.querySelector('[class*="captcha"]:not([style*="display:none"])'),
        slide: !!document.querySelector('[class*="slide"]:not([style*="display:none"])'),
        verify: !!document.querySelector('[class*="verify"]:not([style*="display:none"])'),
        geetest: !!document.querySelector('[class*="geetest"]'),
        dialog: !!(document.querySelector('[class*="dialog"]') && getComputedStyle(document.querySelector('[class*="dialog"]')).display !== 'none'),
      })
    `);

    if (captchaDetected) {
      const cap = JSON.parse(captchaDetected);
      if (cap.captcha || cap.slide || cap.verify || cap.geetest) {
        console.log('  ⚠️ 检测到验证码，需要人工处理');
        await notifyUser('⚠️ 需要人工登录', `巨量引擎登录需要验证码，请在浏览器中完成验证\n登录页: ${SSO_LOGIN_URL}`);
        client.close();
        return { success: false, error: 'captcha_required', captcha: cap };
      }
    }

    // 5. 点击登录按钮
    console.log('  🔘 点击登录...');
    const btnCoords = await client.evalJs(`
      JSON.stringify((() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          if ((b.textContent || '').trim() === '登录' && b.offsetParent && !b.disabled) {
            const r = b.getBoundingClientRect();
            return { x: r.x + r.width/2, y: r.y + r.height/2 };
          }
        }
        return null;
      })())
    `);

    if (btnCoords && btnCoords !== 'null') {
      const btn = JSON.parse(btnCoords);
      await cdpClick(client, btn.x, btn.y);
    } else {
      console.log('  ⚠ 未找到可点击的登录按钮');
    }

    // 6. 等待登录结果（最多15秒）
    console.log('  ⏳ 等待登录结果...');
    let loggedIn = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      url = await client.evalJs('location.href') || '';

      // 检查是否跳转成功
      if (url.includes('business.oceanengine.com') || url.includes('ad.oceanengine.com/promotion')) {
        console.log(`  ✅ 登录成功，跳转: ${url.substring(0, 60)}`);
        loggedIn = true;
        break;
      }

      // 检查是否有验证码弹出
      if (i % 4 === 0) {
        const capCheck = await client.evalJs(`
          (() => {
            const cap = document.querySelector('[class*="captcha"]:not([style*="display:none"])');
            const slide = document.querySelector('[class*="slide"]:not([style*="display:none"])');
            const dialog = document.querySelector('[class*="dialog"]');
            return !!(cap || slide || (dialog && getComputedStyle(dialog).display !== 'none'));
          })()
        `);

        if (capCheck) {
          console.log('  ⚠️ 登录后出现验证码');
          await notifyUser('⚠️ 需要人工验证', `登录页需要滑块/验证码\n登录页: ${SSO_LOGIN_URL}`);
          client.close();
          return { success: false, error: 'captcha_after_login', captcha: true };
        }
      }

      // 检查错误消息
      if (i % 3 === 0) {
        const errorText = await client.evalJs(`
          (() => {
            const msgs = document.querySelectorAll('[class*="message"], [class*="error"], [class*="toast"], [class*="tip"]');
            return Array.from(msgs).filter(m => m.offsetParent).map(m => m.textContent?.trim()).join(' | ') || '';
          })()
        `);
        if (errorText) {
          console.log(`  ⚠ 登录错误: ${errorText.substring(0, 100)}`);
        }
      }
    }

    if (loggedIn) {
      // 7. 导航到投放管理页并等待加载
      await client.call('Page.navigate', { url: CAMPAIGN_URL });
      await sleep(5000);

      // 8. 提取 Cookie
      await extractAndCacheCookies(client);

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  ✅ 自动登录完成 (${elapsed}s)`);

      client.close();
      return { success: true, action: 'login_success', elapsed };
    }

    // 登录超时
    console.log('  ⏰ 登录超时 (15s)');
    await notifyUser('⚠️ 登录状态异常', '自动登录超时，请检查浏览器登录页状态');
    client.close();
    return { success: false, error: 'login_timeout' };

  } catch (e) {
    console.log(`  ❌ 登录异常: ${e.message}`);
    try { client.close(); } catch {}
    return { success: false, error: e.message };
  }
}

/**
 * Cookie 刷新入口（供 oceanengine-api-client 调用）
 * 尝试自动登录，失败则通知用户
 */
export async function refreshLogin(email, password) {
  console.log('🔄 Cookie 过期，尝试自动重新登录...');

  // 先检查是否已登录（浏览器可能已有新 session）
  const tab = await getOceanEngineTab(['投放管理', '巨量引擎工作台']);
  if (tab) {
    try {
      const client = await createCDPClient(tab.webSocketDebuggerUrl, { cmdTimeout: 10000 });
      const cookies = await extractAndCacheCookies(client);
      client.close();
      if (cookies) {
        console.log('  ✅ 浏览器已有有效登录态，Cookie已更新');
        return { success: true, action: 'existing_session' };
      }
    } catch {}
  }

  // 执行完整登录流程
  const result = await autoLogin(email, password);
  return result;
}

export default { autoLogin, refreshLogin };
