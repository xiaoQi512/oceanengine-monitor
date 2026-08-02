// src/services/daily-report-collect.mjs - 日报最终采集
import http from 'node:http';

export async function collectFinalMonitorData({
  node,
  script,
  projectRoot,
  httpGetFn = http.get,
  execSyncFn,
  logFn = console.log,
}) {
  let freshData = false;
  try {
    const alive = await new Promise(resolve => {
      const req = httpGetFn('http://localhost:9222/json/version', { timeout: 5000 }, res => {
        res.on('error', () => resolve(false));
        res.on('data', () => {});
        res.on('end', () => resolve(true));
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
    if (alive) {
      logFn('🔄 Chrome 9222 仍在线，执行最终数据采集...');
      execSyncFn(`"${node}" "${script}"`, {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 300000,
        maxBuffer: 2 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      freshData = true;
      logFn('✅ 最终采集完成');
    } else {
      logFn('⚠ Chrome 9222 已离线，使用已有采样数据生成日报');
    }
  } catch (e) {
    logFn(`⚠ 最终采集异常: ${e.message.slice(0, 100)}，使用已有数据`);
  }
  return freshData;
}
