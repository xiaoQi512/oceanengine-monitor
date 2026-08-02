# 巨量引擎监控 · 项目规范

> 所有强制规则以根目录 `AGENTS.md` 为准，开始前必须先读取。

## 运行环境

### Node.js
- **版本**: Node 22.22.2 (ABI 127)
- **路径**: `C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2\node.exe`
- **PM2 配置**: `ecosystem.config.cjs` 所有进程 `interpreter` 绑定此版本

> ⚠️ **不要使用 PATH 中的 Node 24 (ABI 137)**
> 本机同时存在 Node 24 (`/e/炼丹炉/nodejs/node`)，PM2 脚本强制使用 Node 22。
> 安装/重建原生模块必须用 Node 22 的 npm：
> ```
> "C:/Users/HTF2026/.workbuddy/binaries/node/versions/22.22.2/npm.cmd" install <pkg>
> ```

### 原生模块
- **唯一原生依赖**: `better-sqlite3@12.11.1`
- 已预编译 ABI 127 版本置于 `node_modules/better-sqlite3/build/Release/`
- Node 升级或模块更新后需重新对齐 ABI

## 项目结构

```
E:\炼丹炉\WorkBuddy\巨量引擎监控\
├── ecosystem.config.cjs          # PM2 进程配置 (13个进程)
├── oceanengine-monitor-v3.mjs    # 15分钟完整监控 → buildFeishuCard
├── oceanengine-5min-check.mjs    # 5分钟轻量速报 → pushToLark / pushDetailedCard
├── oceanengine-shift-pusher.mjs  # 主播换班推送 (动态轮询版)
├── oceanengine-api-client.mjs    # 巨量引擎 API 客户端
├── monitor-utils.mjs             # 共享工具 (OEC_SILENT、快照、日志)
├── oceanengine-daily-report-scheduler.mjs  # 日报 23:05
├── oceanengine-daily-summary.mjs           # 日汇总 23:34
├── sync-tomorrow-shifts.mjs                # 次日排班 23:00
├── live-watcher.mjs             # 直播状态监听 (60s轮询)
├── feishu-listener.mjs          # 飞书群消息监听
├── feedback-server.mjs          # Dashboard HTTP 服务 (8899)
├── action-queue-worker.mjs      # 操作队列 worker
├── chrome-guard.mjs             # Chrome 9222 守护
├── feishu-push-guard.mjs        # 飞书推送熔断守卫
├── CARD-FORMAT.md               # 卡片格式规范文档
├── monitor-data/                # 运行时数据与日志
│   ├── monitor.log              # 主日志 (OEC_SILENT=1 时重定向)
│   ├── 5m-*.json                # 5分钟快照
│   ├── daily-*.json             # 日汇总
│   └── shifts-*.json            # 排班缓存
├── db/                          # SQLite 数据库
└── node_modules/
```

## 核心脚本调用链

```
PM2 cron */15 * * * *
  → oceanengine-monitor-v3.mjs
    → createApiClient → collectAllData (campaigns + pageSummary)
    → analyze (计算 delta、告警、生命週期)
    → buildFeishuCard (组装飞书交互卡片)
    → pushCard → 飞书群

PM2 cron */5 * * * *
  → oceanengine-5min-check.mjs
    → 整刻钟: pushDetailedCard (累计+差值双区卡片)
    → 非整刻钟: pushToLark (简洁消耗卡片)
```

## 日志判读提示

- `pm2-*-out.log` 冻结是**正常行为**（`OEC_SILENT=1` 把 stdout → `monitor.log`）
- `pm2 status=stopped` 对于 cron 定时任务也是正常的（跑完即退）
- 健康检查应以 `monitor.log` + `5m-*.json` + `daily-*.json` 为准

## 常用命令

```bash
# 查看所有进程
pm2 status

# 重启监控
pm2 restart pm2-15min pm2-5min

# 查看主日志
tail -f monitor-data/monitor.log

# 重建原生模块 (Node 升级后)
C:/Users/HTF2026/.workbuddy/binaries/node/versions/22.22.2/npm.cmd rebuild better-sqlite3
```
