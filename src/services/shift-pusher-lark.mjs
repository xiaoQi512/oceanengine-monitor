// src/services/shift-pusher-lark.mjs - 换班飞书 CLI 调用与重试
import { execFileSync } from 'node:child_process';
import { findLarkCli, PROJECT_ROOT } from '../utils/monitor-utils.mjs';
import { log } from './shift-pusher-state.mjs';

export function runLarkCli(args, timeoutMs = 20000) {
  const larkCli = findLarkCli();
  if (!larkCli) throw new Error('lark-cli 未找到');
  const isExe = larkCli.endsWith('.exe');
  return execFileSync(
    isExe ? larkCli : 'cmd.exe',
    isExe ? args : ['/c', larkCli, ...args],
    { encoding: 'utf-8', timeout: timeoutMs, windowsHide: true, cwd: PROJECT_ROOT }
  );
}

export function runLarkCliAsync(args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    try { resolve(runLarkCli(args, timeoutMs)); }
    catch (e) { reject(e); }
  });
}

export async function withRetry(fn, label, maxRetries = 3, sleepFn = ms => new Promise(r => setTimeout(r, ms))) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === maxRetries - 1) throw e;
      const delay = 5000 * Math.pow(2, i);
      log('⚠ ' + label + ' 第' + (i + 1) + '/' + maxRetries + '次失败，' + (delay / 1000) + 's后重试: ' + e.message);
      await sleepFn(delay);
    }
  }
}
