# 巨量引擎监控 · 项目规范

> 所有强制规则以根目录 `AGENTS.md` 为准（变更日志 / 分层规范 / Git 推送规范），事故恢复看 `RUNBOOK.md`。开始前必须先读取。

## 运行环境

### Node.js
- **版本**: Node 22.22.2 (ABI 127)，better-sqlite3 原生模块绑定此 ABI
- **路径解析（强制）**: 通过 `C:\Users\HTF2026\.workbuddy\binaries\node\versions\current` 指针文件动态解析（内容为版本目录名）；`ecosystem.config.cjs` 的 `resolveNode()` 已实现三级兜底：current 指针 → 扫描 versions 下最新 22.x 目录 → 系统 Node
- ⚠️ **禁止硬编码版本目录**（如 `versions\22.22.2-2`）——WorkBuddy 更新会改名目录（-2→-3→-6 历史事故），10/19 曾致全家桶全灭
- ⚠️ **不要使用 PATH 中的 Node 24** (`/e/炼丹炉/nodejs/node`)，PM2 脚本强制 Node 22
- 系统 Node 兜底: `C:\nodejs\node-v22.19.0-win-x64`（pm2-watchdog.cjs / dsh-web 同源）

### 原生模块
- **唯一原生依赖**: `better-sqlite3@12.11.1`（预编译 ABI 127 于 `node_modules/better-sqlite3/build/Release/`）
- Node 升级或模块更新后需用 Node 22 的 npm 重建: `"<versions>\<ver>\npm.cmd" rebuild better-sqlite3`

## 项目结构（2026-10 现状）

```
E:\炼丹炉\WorkBuddy\巨量引擎监控\
├── AGENTS.md                     # 强制规范（变更日志/分层/Git 推送）
├── RUNBOOK.md                    # 事故恢复手册（daemon 死亡/更新三连坑/端口孤儿等）
├── ecosystem.config.cjs          # PM2 进程配置 (29 个进程, interpreter 动态解析 Node)
├── pm2-watchdog.cjs              # schtasks 每5min: 探活8899, PM2 死亡自动 resurrect, 写心跳
├── startup.ps1                   # 开机兜底 (current 指针动态解析)
├── src/
│   ├── platform/                 # 巨量引擎 API 客户端 (只依赖 utils/config)
│   ├── domain/                   # 纯业务逻辑 (100+ 模块: rolling 3桶汇总/alerts/analyze/card…)
│   ├── services/                 # 编排层 (monitor-15min/cycle/push, shift-pusher, feedback-server, cloud-sync…)
│   ├── feishu/                   # 推送 (guard 熔断 + direct-api 备选直发)
│   ├── cloud/                    # 小程序云端同步
│   ├── cdp/                      # Chrome CDP (guard.mjs 探活铁律: 127.0.0.1 禁 localhost)
│   ├── config/ + utils/          # 配置与共享工具 (monitor-utils.mjs)
│   └── db/                       # SQLite 读写层
├── scripts/                      # cron 脚本与工具 (backup-db/watchdog/health-daily-report/daily-reconcile/cleanup-snapshots/log-change…)
├── tests/                        # 139 个测试 (node --test tests/*.test.mjs, 必须 glob 展开)
├── monitor-data/                 # 运行时数据 (DB/快照/日志/心跳/备份状态; 快照保留30天自动归档)
└── archive/snapshots/            # 归档快照 (按月分目录, 可逆不删除)
```

## PM2 进程全景 (29 个)

常驻 10: shift-pusher / feishu-listener / live-watcher / feedback-server(8899) / dashboard-tunnel / dsh-tunnel / dsh-web(3080) / budget-watch / action-queue-worker / chrome-guard
cron 跑完即退 19: pm2-5min(*/5) / pm2-15min(*/15) / calc-engine(1-56/5) / model-daily-sync(5时起逐时) / pm2-daily-report(23:05) / pm2-ai-regions(21:33) / pm2-sync-tomorrow(23:00) / pm2-daily-summary(23:35) / pm2-db-backup(23:45) / pm2-watchdog(*/5) / pm2-cloud-sync(2-59/5) / pm2-push-regions(4-59/5) / pm2-push-relay(*/2) / pm2-cloud-action-poller(*/2) / pm2-save(9,39每时) / pm2-health-report(23:50) / pm2-reconcile(23:55) / pm2-cleanup(04:00) / admp-feishu-listener(常驻,另一项目)

**夜间时间线**: 23:00 次日排班 → 23:05 日报 → 23:35 日汇总 → 23:45 SQLite备份 → 23:50 健康日报 → 23:55 对账 → 04:00 快照归档

## 核心调用链

```
pm2-15min → src/services/monitor-15min-cli.mjs → runMonitorCycle (monitor-cycle.mjs)
  → collectAllData (platform/oec-client) → analyze (domain/analyze → buildAlerts → dedupeRootCause)
  → createPushDeps → sendFeishuPush (monitor-push-send: shouldPush → filterRecurringAlerts 跨周期冷却
  → buildFeishuCard → pushCard) → 飞书群

pm2-5min → src/services/monitor-5min-cli.mjs → 整刻钟 pushDetailedCard / 非整刻钟简洁卡
shift-pusher → src/services/shift-pusher-cli.mjs (常驻轮询, 缓存 mtime 自动重载)
```

## 日志与测试

- `pm2-*-out.log` 冻结是**正常行为**（OEC_SILENT=1 把 stdout 重定向到 `monitor-data/monitor.log`）
- cron 进程 status=stopped 是**正常行为**（跑完即退，cron_restart 自动再拉）
- 健康检查以 `monitor.log` + 最新 `5m-*.json` + `heartbeat-task.json` 为准
- 全量测试（**必须 glob 展开**，`--test tests` 目录形式在该 Node 版本会失败）:
  `node --test tests/*.test.mjs`（已知 6 个环境型基线失败: csrf-http/action-queue-lock/ai-regions-core/daily-summary-core/feishu-listener-ai/shift-pusher-snapshot）

## 常用命令

```bash
# PM2 全路径（裸 pm2 已失效）
node "C:/Users/HTF2026/.workbuddy/binaries/node/workspace/node_modules/pm2/bin/pm2" status

# 手动备份 / 对账 / 归档预演
node scripts/backup-db.mjs --verify
node scripts/daily-reconcile.mjs
CLEANUP_DRY_RUN=1 node scripts/cleanup-snapshots.mjs

# 变更日志（AGENTS.md 强制）
node scripts/log-change.mjs --agent <agent> --reason "<原因>" --method "<方法>" --files "<文件>" --result done
```
