// PM2 守护进程看门狗：探活 8899，死了才 resurrect（幂等，健康时零副作用）
// 用途：schtasks 每 5 分钟调用一次，防守护进程随 WorkBuddy 会话清理/系统重启后静默死亡
const { execFileSync } = require('node:child_process');

// 🔧 2026-09-11: 改用系统 Node（C:\nodejs 22.19.0, ABI 127 与 managed 22.22.x 同生态）
// 原因：managed Node 目录随 WorkBuddy 更新换代（-2/-3...），硬编码路径会周期性失效
const NODE = 'C:/nodejs/node-v22.19.0-win-x64/node.exe';
const PM2 = 'C:/Users/HTF2026/.workbuddy/binaries/node/workspace/node_modules/pm2/bin/pm2';
const LOG = 'E:/炼丹炉/WorkBuddy/巨量引擎监控/monitor-data/pm2-watchdog.log';

function log(msg) {
  const ts = new Date().toLocaleString('zh-CN', { hour12: false });
  try { require('node:fs').appendFileSync(LOG, `[${ts}] ${msg}\n`); } catch {}
}

function alive() {
  try {
    // 1) pid 文件指向的进程存在且 8899 可达 → 健康
    const fs = require('node:fs');
    let pid = null;
    try { pid = fs.readFileSync('C:/Users/HTF2026/.pm2/pm2.pid', 'utf8').trim(); } catch {}
    if (pid) {
      try {
        execFileSync('tasklist', ['/FI', `PID eq ${pid}`], { encoding: 'utf8', timeout: 8000, windowsHide: true });
        // tasklist 找不到时输出"没有运行的任务"，需要更精确判断
        const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`], { encoding: 'utf8', timeout: 8000, windowsHide: true });
        if (!out.includes('没有运行的任务') && out.includes('node.exe')) return true;
      } catch {}
    }
  } catch {}
  // 2) 8899 探活兜底（feedback-server 由 PM2 托管，可达≈全家桶活着）
  // ⚠️ 不能用 -o /dev/null（Windows 原生 curl 无此路径）；用 -w 只取 http_code，任何响应码都算活着
  try {
    const out = execFileSync('curl', ['-s', '--max-time', '4', '--noproxy', '*', '-w', '%{http_code}',
      'http://127.0.0.1:8899/dashboard-v5'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    if (out && /\d{3}/.test(out)) return true;
  } catch {}
  return false;
}

(async () => {
  if (alive()) return;  // 健康，静默退出
  log('检测到 PM2 死亡，执行 resurrect');
  try {
    const out = execFileSync(NODE, [PM2, 'resurrect'], {
      encoding: 'utf8', timeout: 60000, windowsHide: true,
      env: { ...process.env, PM2_HOME: 'C:/Users/HTF2026/.pm2' },
    });
    log('resurrect 完成: ' + (out || '').slice(0, 100).replace(/\n/g, ' '));
  } catch (e) {
    log('resurrect 失败: ' + String(e.message).slice(0, 200));
  }
})();
