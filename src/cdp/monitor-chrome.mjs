// src/cdp/monitor-chrome.mjs - 监控侧 Chrome 探活与拉起
import http from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP_PORT } from '../config/index.mjs';

export function checkChrome() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${CDP_PORT}/json/version`, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { const json = JSON.parse(data); resolve(!!json.Browser); }
        catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

export async function launchChrome({ findChromeExe, chromeUserDataDir, chromeProfileDirectory, campaignUrl }) {
  console.log(`  🔄 尝试自动拉起 Chrome (${CDP_PORT}端口)...`);
  const chromeExe = findChromeExe();
  if (!chromeExe) {
    console.log('  ⚠ 未找到 Chrome 安装路径，无法自动拉起');
    return false;
  }
  try {
    const args = [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${chromeUserDataDir}`,
      `--profile-directory=${chromeProfileDirectory}`,
      '--no-first-run',
      '--no-default-browser-check',
      campaignUrl,
    ];
    const child = spawn(chromeExe, args, {
      detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.unref();
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      if (await checkChrome()) {
        console.log(`  ✅ Chrome 自动拉起成功 (${CDP_PORT}端口已就绪)`);
        return true;
      }
    }
    console.log('  ⚠ Chrome 启动超时，请手动检查');
    return false;
  } catch (e) {
    console.log(`  ❌ Chrome 启动失败: ${e.message}`);
    return false;
  }
}
