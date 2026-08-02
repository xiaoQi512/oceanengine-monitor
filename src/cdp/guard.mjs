// chrome-guard.mjs — Chrome 9222 + CDP proxy 3456 守护进程
// 每60秒探活，挂了自动拉起
// 由 PM2 常驻托管，崩溃自愈
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {
  CHROME_USER_DATA_DIR,
  CHROME_PROFILE_DIRECTORY,
  CDP_PORT,
  CDP_PROXY_PORT,
  DATA_DIR,
  findChromeExe,
} from '../utils/monitor-utils.mjs';

const LOG_FILE = path.join(DATA_DIR, 'chrome-guard.log');
const CHECK_INTERVAL_MS = 60_000;  // 60秒探活一次
const RECOVERY_WAIT_MS = 3_000;    // 拉起后等3秒再探活
const MAX_RECOVERY_ATTEMPTS = 5;   // 连续恢复失败上限

function log(msg) {
  const line = `[${new Date().toLocaleString()}] [chrome-guard] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// 探活 HTTP 端点
function probe(url, timeoutMs = 5000) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// 拉起 Chrome
function launchChrome() {
  const chromeExe = findChromeExe();
  if (!chromeExe) {
    log('❌ 未找到 Chrome 安装路径');
    return false;
  }
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_USER_DATA_DIR}`,
    `--profile-directory=${CHROME_PROFILE_DIRECTORY}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  try {
    const child = spawn(chromeExe, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    log(`✅ Chrome 进程已拉起 (PID ${child.pid})`);
    return true;
  } catch (e) {
    log(`❌ Chrome 启动失败: ${e.message}`);
    return false;
  }
}

// 拉起 CDP proxy
function launchCdpProxy() {
  const proxyScript = path.join(
    process.env.HOME || process.env.USERPROFILE || 'C:/Users/HTF2026',
    '.workbuddy/skills/skill_2053083109158420480/scripts/cdp-proxy.mjs'
  );
  if (!fs.existsSync(proxyScript)) {
    log('❌ CDP proxy 脚本不存在: ' + proxyScript);
    return false;
  }
  const nodeExe = process.execPath;
  try {
    const child = spawn(nodeExe, [proxyScript], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    log(`✅ CDP proxy 进程已拉起 (PID ${child.pid})`);
    return true;
  } catch (e) {
    log(`❌ CDP proxy 启动失败: ${e.message}`);
    return false;
  }
}

// 恢复流程
async function recover(service) {
  if (service === 'chrome') {
    return launchChrome();
  } else if (service === 'cdp-proxy') {
    return launchCdpProxy();
  }
  return false;
}

// 主循环
async function main() {
  log('🚀 Chrome Guard 启动');
  log(`   探活间隔: ${CHECK_INTERVAL_MS / 1000}s`);
  log(`   Chrome: localhost:${CDP_PORT}`);
  log(`   CDP proxy: localhost:${CDP_PROXY_PORT}`);

  let consecutiveFailures = 0;

  while (true) {
    try {
      const chromeOk = await probe(`http://localhost:${CDP_PORT}/json/version`);
      const proxyOk = await probe(`http://localhost:${CDP_PROXY_PORT}/targets`);

      if (chromeOk && proxyOk) {
        consecutiveFailures = 0;
        // 静默健康，不刷日志
      } else {
        if (!chromeOk) {
          log(`⚠ Chrome ${CDP_PORT} 不可达，尝试恢复...`);
          const recovered = await recover('chrome');
          if (recovered) {
            await new Promise(r => setTimeout(r, RECOVERY_WAIT_MS * 3));  // Chrome 启动慢
            const recheck = await probe(`http://localhost:${CDP_PORT}/json/version`);
            if (recheck) {
              log('✅ Chrome 恢复成功');
            } else {
              log('❌ Chrome 恢复后仍不可达');
              consecutiveFailures++;
            }
          } else {
            consecutiveFailures++;
          }
        }

        if (!proxyOk) {
          log(`⚠ CDP proxy ${CDP_PROXY_PORT} 不可达，尝试恢复...`);
          const recovered = await recover('cdp-proxy');
          if (recovered) {
            await new Promise(r => setTimeout(r, RECOVERY_WAIT_MS));
            const recheck = await probe(`http://localhost:${CDP_PROXY_PORT}/targets`);
            if (recheck) {
              log('✅ CDP proxy 恢复成功');
            } else {
              log('❌ CDP proxy 恢复后仍不可达');
              consecutiveFailures++;
            }
          } else {
            consecutiveFailures++;
          }
        }

        // 连续失败告警
        if (consecutiveFailures >= MAX_RECOVERY_ATTEMPTS) {
          log(`🔴 连续 ${consecutiveFailures} 次恢复失败，可能需要人工介入`);
          consecutiveFailures = 0;  // 重置，下个周期继续尝试
        }
      }
    } catch (e) {
      log(`❌ 守护循环异常: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
  }
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
