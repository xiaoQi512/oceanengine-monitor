// ecosystem.config.cjs — PM2 进程配置（巨量引擎监控全家桶）
// 用法: pm2 start ecosystem.config.cjs
//       pm2 start ecosystem.config.cjs --only pm2-5min   (仅启动5分钟)
//       pm2 start ecosystem.config.cjs --only pm2-15min  (仅启动15分钟)
const MONITOR_DIR = 'E:\\炼丹炉\\WorkBuddy\\巨量引擎监控';
const LOG_DIR = `${MONITOR_DIR}\\monitor-data`;
const NODE = 'C:\\Users\\HTF2026\\.workbuddy\\binaries\\node\\versions\\22.22.2\\node.exe';

module.exports = {
  apps: [
    // ====== 已上线：换班推送常驻守护 ======
    {
      name: 'shift-pusher',
      script: 'oceanengine-shift-pusher.mjs',
      cwd: MONITOR_DIR,
      env: {
        OEC_SILENT: '1',
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_memory_restart: '300M',
      out_file: `${LOG_DIR}\\pm2-shift-out.log`,
      error_file: `${LOG_DIR}\\pm2-shift-err.log`,
      merge_logs: true,
      time: true,
      cron_restart: '0 6 * * *',
    },

    // ====== 5分钟速报（cron 触发，跑完即退）======
    {
      name: 'pm2-5min',
      script: 'oceanengine-5min-check.mjs',
      cwd: MONITOR_DIR,
      exec_mode: 'fork',
      interpreter: NODE,
      env: {
        OEC_SILENT: '1',
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 30000,
      cron_restart: '*/5 * * * *',
      out_file: `${LOG_DIR}\\pm2-5min-out.log`,
      error_file: `${LOG_DIR}\\pm2-5min-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 15分钟监控（cron 触发，跑完即退）======
    {
      name: 'pm2-15min',
      script: 'oceanengine-monitor-v3.mjs',
      cwd: MONITOR_DIR,
      exec_mode: 'fork',
      interpreter: NODE,
      env: {
        OEC_SILENT: '1',
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 60000,
      cron_restart: '*/15 * * * *',
      out_file: `${LOG_DIR}\\pm2-15min-out.log`,
      error_file: `${LOG_DIR}\\pm2-15min-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 日报 23:05（cron 触发，跑完即退）======
    {
      name: 'pm2-daily-report',
      script: 'oceanengine-daily-report-scheduler.mjs',
      cwd: MONITOR_DIR,
      exec_mode: 'fork',
      interpreter: NODE,
      env: {
        OEC_SILENT: '1',
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 300000,   // 日报可能跑5分钟（含v3采集）
      cron_restart: '5 23 * * *',
      out_file: `${LOG_DIR}\\pm2-daily-report-out.log`,
      error_file: `${LOG_DIR}\\pm2-daily-report-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== AI区域号汇总 21:30（cron 触发，跑完即退）======
    {
      name: 'pm2-ai-regions',
      script: 'ai-regions-http.mjs',
      cwd: MONITOR_DIR,
      exec_mode: 'fork',
      interpreter: NODE,
      env: {
        OEC_SILENT: '1',
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 120000,   // 5个账户CDP拉取可能2分钟
      cron_restart: '30 21 * * *',
      out_file: `${LOG_DIR}\\pm2-ai-regions-out.log`,
      error_file: `${LOG_DIR}\\pm2-ai-regions-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== action-queue-worker 常驻 (watch模式，每15s轮询操作队列) ======
    {
      name: 'action-queue-worker',
      script: 'action-queue-worker.mjs',
      args: '--watch',
      cwd: MONITOR_DIR,
      exec_mode: 'fork',
      interpreter: NODE,
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_memory_restart: '200M',
      out_file: `${LOG_DIR}\\pm2-worker-out.log`,
      error_file: `${LOG_DIR}\\pm2-worker-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== feedback-server 常驻 HTTP 服务 (端口 8899) ======
    {
      name: 'feedback-server',
      script: 'feedback-server.mjs',
      cwd: MONITOR_DIR,
      exec_mode: 'fork',
      interpreter: NODE,
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 5000,
      max_memory_restart: '200M',
      out_file: `${LOG_DIR}\\pm2-feedback-out.log`,
      error_file: `${LOG_DIR}\\pm2-feedback-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== Chrome 9222 守护（常驻，每60s探活，崩溃自动拉起）======
    {
      name: 'chrome-guard',
      script: 'chrome-guard.mjs',
      cwd: MONITOR_DIR,
      exec_mode: 'fork',
      interpreter: NODE,
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_memory_restart: '100M',
      out_file: `${LOG_DIR}\\pm2-chrome-guard-out.log`,
      error_file: `${LOG_DIR}\\pm2-chrome-guard-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== 日汇总 23:10（错开5min避免与daily-report争抢CDP，TD-3 2026-06-29）======
    {
      name: 'pm2-daily-summary',
      script: 'oceanengine-daily-summary.mjs',
      cwd: MONITOR_DIR,
      exec_mode: 'fork',
      interpreter: NODE,
      env: {
        OEC_SILENT: '1',
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 120000,
      cron_restart: '10 23 * * *',
      out_file: `${LOG_DIR}\\pm2-daily-summary-out.log`,
      error_file: `${LOG_DIR}\\pm2-daily-summary-err.log`,
      merge_logs: true,
      time: true,
    },

    // ====== PM2 冒烟测试（手动触发，跑完即退）======
    {
      name: 'pm2-test',
      script: 'pm2-smoke-test.mjs',
      cwd: MONITOR_DIR,
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: false,
      max_restarts: 0,
      kill_timeout: 30000,
      out_file: `${LOG_DIR}\\pm2-test-out.log`,
      error_file: `${LOG_DIR}\\pm2-test-err.log`,
      merge_logs: true,
      time: true,
    },
  ],
};
