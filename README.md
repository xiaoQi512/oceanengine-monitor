# 巨量引擎监控

[![CI](https://github.com/xiaoQi512/oceanengine-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/xiaoQi512/oceanengine-monitor/actions/workflows/ci.yml)

巨量引擎广告账户实时监控系统，5分钟/15分钟定时推送飞书卡片，支持主播换班数据同步、日程报表生成、Dashboard 可视化。

## 代码量统计

| 类型  | 文件数 | 行数   | 说明 |
|-------|--------|--------|------|
| .mjs  | 150 | 39359 | Node.js 核心脚本 (监控/推送/API) |
| .py   | 34 | 5852 | 多 Agent 编排脚本 |
| .html | 42 | 12830 | Dashboard 页面模板 |
| .md   | 115 | 19186 | 文档/规范/Prompts |
| .js   | 7 | 423 | JS 源文件 |
| .sql  | 6 | 455 | 数据库迁移脚本 |
| .ps1  | 5 | 445 | PowerShell 维护脚本 |
| .sh   | 4 | 347 | Shell 辅助脚本 |
| .css  | 1 | 83 | Dashboard 样式 |
| .xml  | 1 | 49 | 配置文件 |

> **核心代码**: .mjs + .py = 184 个文件 · 45211 行
> 统计时间: 2026-07-20 21:29 · 不含 node_modules / monitor-data / .git
> 更新: `bash scripts/count-lines.sh --markdown`

## 运行环境

- **Node.js**: 22.22.2 (ABI 127)
- **进程管理**: PM2 (13 个进程，`ecosystem.config.cjs`)
- **数据库**: SQLite (`db/` 目录，物化视图刷新)
- **推送**: 飞书群交互卡片 (lark-cli + pushCard)

## 核心脚本

| 脚本 | 用途 | 调度 |
|------|------|------|
| `oceanengine-monitor-v3.mjs` | 15分钟完整监控 → 飞书卡片 | `*/15 * * * *` |
| `oceanengine-5min-check.mjs` | 5分钟轻量速报 → 飞书卡片 | `*/5 * * * *` |
| `oceanengine-shift-pusher.mjs` | 主播换班数据推送 (动态轮询) | 常驻守护 |
| `oceanengine-daily-summary.mjs` | 日汇总 23:34 | `34 23 * * *` |
| `oceanengine-daily-report-scheduler.mjs` | 日报 23:05 | `5 23 * * *` |
| `sync-tomorrow-shifts.mjs` | 次日排班同步 23:00 | `0 23 * * *` |
| `live-watcher.mjs` | 直播状态监听 (60s轮询) | 常驻守护 |
| `feishu-listener.mjs` | 飞书群消息监听 | 常驻守护 |
| `feedback-server.mjs` | Dashboard HTTP 服务 (8899) | 常驻守护 |

## 快速开始

```bash
# 启动全部监控
pm2 start ecosystem.config.cjs
pm2 save

# 仅启动核心监控
pm2 start ecosystem.config.cjs --only pm2-15min --only pm2-5min --only shift-pusher

# 查看运行状态
pm2 status

# 查看实时日志
tail -f monitor-data/monitor.log

# 重建原生模块
C:/Users/HTF2026/.workbuddy/binaries/node/versions/22.22.2/npm.cmd rebuild better-sqlite3

# 更新代码量统计
bash scripts/count-lines.sh --markdown
```

## 文档

- [卡片格式规范](CARD-FORMAT.md) — API字段映射 + 计算逻辑
- [项目规范](CODEBUDDY.md) — Node版本、目录结构、常用命令
