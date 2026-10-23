// ecosystem.config.cjs — PM2 进程配置（巨量引擎监控全家桶）
// 用法: pm2 start ecosystem.config.cjs
//       pm2 start ecosystem.config.cjs --only pm2-5min   (仅启动5分钟)
//       pm2 start ecosystem.config.cjs --only pm2-15min  (仅启动15分钟)
const MONITOR_DIR = process.env.MONITOR_DIR || __dirname;
const LOG_DIR = `${MONITOR_DIR}\\monitor-data`;
// node 路径自动跟随 WorkBuddy 的 versions/current 指针，避免版本目录改名后进程变幽灵
// （2026-08-29: 22.22.2 → 22.22.2-2；2026-09-11: → 22.22.2-3，均为同一问题）
const fs = require("fs");
const path = require("path");
const VERSIONS_DIR = "C:\\Users\\HTF2026\\.workbuddy\\binaries\\node\\versions";
function resolveNode() {
  try {
    const v = fs.readFileSync(path.join(VERSIONS_DIR, "current"), "utf-8").trim();
    const p = path.join(VERSIONS_DIR, v, "node.exe");
    if (fs.existsSync(p)) return p;
  } catch {}
  // 兜底1: current 指针失败时扫描 versions 下最新 22.x 目录
  // (2026-10-23: 旧兜底硬编码 22.22.2-3 目录已随 WorkBuddy 更新消失, 等于无兜底)
  try {
    const dirs = fs.readdirSync(VERSIONS_DIR)
      .filter(d => /^22\.\d+\.\d+/.test(d) && fs.existsSync(path.join(VERSIONS_DIR, d, "node.exe")))
      .sort();
    if (dirs.length) return path.join(VERSIONS_DIR, dirs[dirs.length - 1], "node.exe");
  } catch {}
  // 兜底2: 系统 Node (与 pm2-watchdog.cjs / dsh-web 同源, 不随 WorkBuddy 换代失效)
  return "C:/nodejs/node-v22.19.0-win-x64/node.exe";
}
const NODE = process.env.NODE_EXE || resolveNode();

// 2026-10-23: 清空继承的失效代理(会话代理端口每次变化, 旧端口会让 lark-cli 读表/推送全部 proxyconnect 失败)
const PROXY_CLEAN = { HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", http_proxy: "", https_proxy: "", all_proxy: "", NO_PROXY: "*" };

module.exports = {
  apps: [
    // ====== 换班推送 常驻守护 ======
    {
      name: "shift-pusher",
      script: "src/services/shift-pusher-cli.mjs",
      cwd: MONITOR_DIR,
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production" },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_memory_restart: "300M",
      out_file: `${LOG_DIR}\\pm2-shift-out.log`,
      error_file: `${LOG_DIR}\\pm2-shift-err.log`,
      merge_logs: true,
      time: true,
      cron_restart: "0 6 * * *",
    },

    // ====== 飞书群消息监听 常驻 (轮询模式，每10s拉取群消息) ======
    {
      name: "feishu-listener",
      script: "src/services/feishu-listener-cli.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production" },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_memory_restart: "200M",
      out_file: `${LOG_DIR}\\pm2-feishu-listener-out.log`,
      error_file: `${LOG_DIR}\\pm2-feishu-listener-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== feedback-server
    // ====== 直播状态监听 常驻 (每60s轮询，跟踪开播/下播，触发日汇总) ======
    {
      name: "live-watcher",
      script: "src/services/live-watcher-cli.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production" },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_memory_restart: "256M",
      out_file: `${LOG_DIR}\\pm2-live-watcher-out.log`,
      error_file: `${LOG_DIR}\\pm2-live-watcher-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== feedback-server 常驻 HTTP 服务 (端口 8899, Dashboard 依赖) ======
    {
      name: "feedback-server",
      script: "src/services/http-server-cli.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production" },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 5000,
      max_memory_restart: "200M",
      out_file: `${LOG_DIR}\\pm2-feedback-out.log`,
      error_file: `${LOG_DIR}\\pm2-feedback-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== dashboard-tunnel 常驻：仪表盘密码认证代理 + cloudflared 快速隧道 ======
    {
      name: "dashboard-tunnel",
      script: "src/services/dashboard-tunnel.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production" },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_memory_restart: "128M",
      out_file: `${LOG_DIR}\\pm2-dashboard-tunnel-out.log`,
      error_file: `${LOG_DIR}\\pm2-dashboard-tunnel-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== dsh-tunnel 常驻：DSH web 独立远程隧道（认证代理 8897 -> 3080 + cloudflared）======
    {
      name: "dsh-tunnel",
      script: "src/services/dsh-tunnel.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production" },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_memory_restart: "128M",
      out_file: `${LOG_DIR}\\pm2-dsh-tunnel-out.log`,
      error_file: `${LOG_DIR}\\pm2-dsh-tunnel-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== dsh-web 常驻：DSH web 服务本体（127.0.0.1:3080），远程访问不依赖桌面版 ======
    // 2026-10-19: 改用系统 Node 全局 dsh（C:\nodejs 22.19.0），旧 versions\22.22.2\node_modules 随 WorkBuddy 更新消失
    {
      name: "dsh-web",
      script: "C:/nodejs/node-v22.19.0-win-x64/node_modules/@deepseek-ai/dsh/lib/bin.js",
      args: "web",
      cwd: "C:/nodejs/node-v22.19.0-win-x64/node_modules/@deepseek-ai/dsh",
      exec_mode: "fork",
      interpreter: "C:/nodejs/node-v22.19.0-win-x64/node.exe", // 跟随 dsh 安装运行时，不随 WorkBuddy 换代失效
      env: { ...PROXY_CLEAN, NODE_ENV: "production" },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 15000,
      max_memory_restart: "600M",
      out_file: `${LOG_DIR}\\pm2-dsh-web-out.log`,
      error_file: `${LOG_DIR}\\pm2-dsh-web-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 核算引擎（统一数据层, cron 触发，跑完即退）======
    {
      name: "calc-engine",
      script: "src/services/calc-engine.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production" },
      instances: 1,
      autorestart: false,
      max_restarts: 100,
      kill_timeout: 30000,
      cron_restart: "1-56/5 * * * *",
      out_file: `${LOG_DIR}\\pm2-calc-out.log`,
      error_file: `${LOG_DIR}\\pm2-calc-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 每日车型消耗同步飞书 (5:05 首跑, 出数延迟时逐小时重试到 11 点) ======
    {
      name: "model-daily-sync",
      script: "src/services/sync-model-daily-feishu.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production", OEC_SILENT: "1", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", http_proxy: "", https_proxy: "", all_proxy: "" },
      instances: 1,
      autorestart: false,
      max_restarts: 100,
      kill_timeout: 30000,
      cron_restart: "5 5-11 * * *",
      out_file: `${LOG_DIR}\\pm2-model-sync-out.log`,
      error_file: `${LOG_DIR}\\pm2-model-sync-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== AI 大区预算使用率监控 (常驻状态机: 30min慢循环/5min快循环, ≥80%且CPL<110 报监控群) ======
    {
      name: "budget-watch",
      script: "src/services/budget-watch.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production", OEC_SILENT: "1", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", http_proxy: "", https_proxy: "", all_proxy: "" },
      instances: 1,
      autorestart: true,
      max_restarts: 100,
      kill_timeout: 30000,
      out_file: `${LOG_DIR}\\pm2-budget-out.log`,
      error_file: `${LOG_DIR}\\pm2-budget-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 5分钟速报（cron 触发，跑完即退）======
    {
      name: "pm2-5min",
      script: "src/services/monitor-5min-cli.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production" },
      instances: 1,
      autorestart: false,
      max_restarts: 100,
      kill_timeout: 30000,
      cron_restart: "*/5 * * * *",
      out_file: `${LOG_DIR}\\pm2-5min-out.log`,
      error_file: `${LOG_DIR}\\pm2-5min-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 15分钟监控（cron 触发，跑完即退）======
    {
      name: "pm2-15min",
      script: "src/services/monitor-15min-cli.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production" },
      instances: 1,
      autorestart: false,
      max_restarts: 100,
      kill_timeout: 60000,
      cron_restart: "*/15 * * * *",
      out_file: `${LOG_DIR}\\pm2-15min-out.log`,
      error_file: `${LOG_DIR}\\pm2-15min-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 日报 23:05（cron 触发，跑完即退）======
    {
      name: "pm2-daily-report",
      script: "src/services/cron-daily-report-cli.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, OEC_SILENT: "1", NODE_ENV: "production" },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 300000,
      cron_restart: "5 23 * * *",
      out_file: `${LOG_DIR}\\pm2-daily-report-out.log`,
      error_file: `${LOG_DIR}\\pm2-daily-report-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== AI区域号汇总 21:33（cron 触发，跑完即退）======
    {
      name: "pm2-ai-regions",
      script: "src/services/cron-ai-regions-cli.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, OEC_SILENT: "1", NODE_ENV: "production" },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 120000,
      cron_restart: "33 21 * * *",
      out_file: `${LOG_DIR}\\pm2-ai-regions-out.log`,
      error_file: `${LOG_DIR}\\pm2-ai-regions-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== action-queue-worker 常驻 (watch模式，每15s轮询操作队列) ======
    {
      name: "action-queue-worker",
      script: "src/services/action-worker-cli.mjs",
      args: "--watch",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production" },
      // [v1.1] 必须单实例：文件锁 wx 标志依赖单进程互斥；容器化时需升级为 Redis 锁
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_memory_restart: "200M",
      out_file: `${LOG_DIR}\\pm2-worker-out.log`,
      error_file: `${LOG_DIR}\\pm2-worker-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== Chrome 9222 守护（常驻，每60s探活，崩溃自动拉起）======
    {
      name: "chrome-guard",
      script: "src/cdp/guard.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production" },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_memory_restart: "256M",
      out_file: `${LOG_DIR}\\pm2-chrome-guard-out.log`,
      error_file: `${LOG_DIR}\\pm2-chrome-guard-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== AD监控软件-飞书命令监听 常驻 (V1.5: 注册账户/采集/登录群命令; 必须用户会话——
    //        LocalSystem 下 lark-cli OAuth 无法认证 code 20140, 故挂 PM2 而非 WinSW 服务) ======
    {
      name: "admp-feishu-listener",
      script: "E:\\炼丹炉\\WorkBuddy\\ad-monitor-win\\src\\feishu\\command-listener.mjs",
      cwd: "E:\\炼丹炉\\WorkBuddy\\ad-monitor-win",
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production" },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_memory_restart: "150M",
      out_file: "E:\\炼丹炉\\WorkBuddy\\ad-monitor-win\\logs\\pm2-listener-out.log",
      error_file: "E:\\炼丹炉\\WorkBuddy\\ad-monitor-win\\logs\\pm2-listener-err.log",
      merge_logs: true,
      time: true,
    },

    // ====== 次日排班同步 23:00（每日提前缓存次日主播排班）======
    {
      name: "pm2-sync-tomorrow",
      script: "src/services/cron-sync-shifts-cli.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      // 2026-10-23: 清空继承的失效代理(127.0.0.1:65xxx 中继已停), 否则 lark-cli 23:00 同步必然 proxyconnect 失败
      env: { ...PROXY_CLEAN, NODE_ENV: "production", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", http_proxy: "", https_proxy: "", all_proxy: "", NO_PROXY: "*" },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 30000,
      cron_restart: "0 23 * * *",
      out_file: `${LOG_DIR}\\pm2-sync-tomorrow-out.log`,
      error_file: `${LOG_DIR}\\pm2-sync-tomorrow-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 日汇总 23:35（全天数据核对后推送）======
    {
      name: "pm2-daily-summary",
      script: "src/services/cron-daily-summary-cli.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, OEC_SILENT: "1", NODE_ENV: "production", DAILY_SUMMARY_FALLBACK: "1" },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 120000,
      cron_restart: "35 23 * * *",
      out_file: `${LOG_DIR}\\pm2-daily-summary-out.log`,
      error_file: `${LOG_DIR}\\pm2-daily-summary-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== SQLite 自动备份 23:45（日汇总后执行，WAL 在线备份）======
    {
      name: "pm2-db-backup",
      script: "scripts/backup-db.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production", OEC_SILENT: "1" },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 120000,
      cron_restart: "45 23 * * *",
      out_file: `${LOG_DIR}\\pm2-backup-out.log`,
      error_file: `${LOG_DIR}\\pm2-backup-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 监控健康检查 watchdog（每5分钟，检查快照新鲜度与 8899 服务）======
    // 2026-10-20: env 清洗 — daemon(用户终端 resurrect)env 可能带 WorkBuddy 代理(HTTP(S)_PROXY)
    // 与 NODE_OPTIONS 语言 shim 注入, 导致 fetch 被劫持走代理 → 127.0.0.1:8899 被拒, 连续 30 轮误报
    {
      name: "pm2-watchdog",
      script: "scripts/watchdog.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN,
        NODE_ENV: "production",
        OEC_SILENT: "1",
        NODE_OPTIONS: "",            // 剥掉语言 shim 注入
        HTTP_PROXY: "",              // 剥掉代理劫持
        HTTPS_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        NO_PROXY: "*",
        no_proxy: "*",
      },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 30000,
      cron_restart: "*/5 * * * *",
      out_file: `${LOG_DIR}\\pm2-watchdog-out.log`,
      error_file: `${LOG_DIR}\\pm2-watchdog-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 小程序云同步 (每5min, 在5min快照落盘2分钟后推送上云; 2026-09-18 由15min提速, 消耗高峰期小程序滞后从~15min降到~5min) ======
    {
      name: "pm2-cloud-sync",
      script: "src/cloud/cloud-sync.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production", OEC_SILENT: "1" },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 30000,
      cron_restart: "2-59/5 * * * *",
      out_file: `${LOG_DIR}\\pm2-cloud-sync-out.log`,
      error_file: `${LOG_DIR}\\pm2-cloud-sync-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 小程序"五区直播"页数据源 (每5min: 8899 sessions API → cloudrun /push regions_live) ======
    {
      name: "pm2-push-regions",
      script: "src/cloud/push-regions.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production", OEC_SILENT: "1" },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 15000,
      cron_restart: "4-59/5 * * * *",
      out_file: `${LOG_DIR}\\pm2-push-regions-out.log`,
      error_file: `${LOG_DIR}\\pm2-push-regions-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 推送队列中继 (每2min消费 push-queue: 写表/发消息失败自动重试; 2026-10-08
    //        原计划任务 9/27 后失效, 改为 PM2 托管; 代理变量清空防 proxyconnect 拒连) ======
    {
      name: "pm2-push-relay",
      script: "src/feishu/relay-flush.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", http_proxy: "", https_proxy: "", all_proxy: "" },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 30000,
      cron_restart: "*/2 * * * *",
      out_file: `${LOG_DIR}\\pm2-push-relay-out.log`,
      error_file: `${LOG_DIR}\\pm2-push-relay-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 小程序云端指令轮询 (每2min, 拉取小程序操作指令→本地队列执行→回写结果) ======
    {
      name: "pm2-cloud-action-poller",
      script: "src/cloud/cloud-action-poller.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production", OEC_SILENT: "1" },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 120000,
      cron_restart: "*/2 * * * *",
      out_file: `${LOG_DIR}\\pm2-cloud-poller-out.log`,
      error_file: `${LOG_DIR}\\pm2-cloud-poller-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== pm2 save 固化 (每30min, 防 daemon 死后 resurrect 到旧进程表; 2026-10-23 新增) ======
    {
      name: "pm2-save",
      script: "scripts/pm2-save-cron.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production", OEC_SILENT: "1" },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 60000,
      cron_restart: "9,39 * * * *",
      out_file: `${LOG_DIR}\\pm2-save-out.log`,
      error_file: `${LOG_DIR}\\pm2-save-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 系统健康日报 23:50 (进程/快照/DB/备份/心跳 汇总推监控群; 2026-10-23 新增) ======
    {
      name: "pm2-health-report",
      script: "scripts/health-daily-report.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production", OEC_SILENT: "1", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", http_proxy: "", https_proxy: "", all_proxy: "" },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 60000,
      cron_restart: "50 23 * * *",
      out_file: `${LOG_DIR}\\pm2-health-report-out.log`,
      error_file: `${LOG_DIR}\\pm2-health-report-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 每日对账 23:55 (DB agg_shift vs 飞书班次表昨日终值; 2026-10-23 新增) ======
    {
      name: "pm2-reconcile",
      script: "scripts/daily-reconcile.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production", OEC_SILENT: "1", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", http_proxy: "", https_proxy: "", all_proxy: "" },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 120000,
      cron_restart: "55 23 * * *",
      out_file: `${LOG_DIR}\\pm2-reconcile-out.log`,
      error_file: `${LOG_DIR}\\pm2-reconcile-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 快照归档清理 04:00 (快照保留30天, 移入 archive/snapshots; 2026-10-23 新增) ======
    {
      name: "pm2-cleanup",
      script: "scripts/cleanup-snapshots.mjs",
      cwd: MONITOR_DIR,
      exec_mode: "fork",
      interpreter: NODE,
      env: { ...PROXY_CLEAN, NODE_ENV: "production", OEC_SILENT: "1" },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 600000,
      cron_restart: "0 4 * * *",
      out_file: `${LOG_DIR}\\pm2-cleanup-out.log`,
      error_file: `${LOG_DIR}\\pm2-cleanup-err.log`,
      merge_logs: true,
      time: true,
    },
  ],
};
