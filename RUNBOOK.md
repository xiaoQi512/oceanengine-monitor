# RUNBOOK — 巨量引擎监控 事故恢复手册

> 事故时照此操作，不凭记忆。最后更新: 2026-10-23。
> 关键事实速查见文末。所有终端操作在 **用户 PowerShell 会话**执行（沙箱/服务环境有诸多限制，见各节）。

---

## 0. 一分钟体检（任何异常先跑这个）

```powershell
cd "E:\炼丹炉\WorkBuddy\巨量引擎监控"
& "C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" "C:\Users\HTF2026\.workbuddy\binaries\node\workspace\node_modules\pm2\bin\pm2" status
```

- 常驻进程（feedback-server / chrome-guard / feishu-listener / live-watcher / shift-pusher / action-queue-worker / budget-watch / dashboard-tunnel / dsh-tunnel / dsh-web）应全为 `online`
- `stopped` 对 cron 型进程（pm2-5min / pm2-15min / pm2-db-backup / pm2-watchdog / pm2-save 等）是**正常**（跑完即退，cron 自动再拉）
- 再看日志: `monitor-data\monitor.log` + 最新 `5m-*.json`（`pm2-*-out.log` 冻结是常态，OEC_SILENT 重定向走了）

> Node 版本目录会随 WorkBuddy 更新改名（22.22.2-3→-6…），上面命令若 ENOENT，
> 先看 `C:\Users\HTF2026\.workbuddy\binaries\node\versions\current` 文件内容，替换其中的版本号。

---

## 1. PM2 daemon 死亡 / 全家桶停摆

**症状**: pm2 status 报 daemon not running / 全部进程消失；飞书推送静默。

**正常情况会自愈**: `pm2-watchdog.cjs`（schtasks 每 5min）探活 8899，死了自动 resurrect。
先等 5 分钟再动手。若 schtasks 通道也停摆（见 §4），手动恢复：

```powershell
& "<node.exe 全路径>" "C:\Users\HTF2026\.workbuddy\binaries\node\workspace\node_modules\pm2\bin\pm2" resurrect
```

**恢复后必做**（2026-10-19 教训）:
1. `pm2 status` 核对常驻 10 进程 online
2. 核对最新 `5m-*.json` 时间戳在 10 分钟内（5m 快照恢复）
3. 检查 `monitor-data\heartbeat-task.json` 心跳在恢复（schtasks 通道存活）
4. `pm2 save` 固化（现在有 pm2-save cron 每 30min 兜底）

## 2. WorkBuddy 更新三连坑（更新后必查）

2026-10-19 实锤，更新会引发：
1. **versions 旧目录消失** → 任何硬编码 `versions\22.22.2*` 的脚本全灭
   - 现状: ecosystem / pm2-save-cron / health-daily-report 已改为「current 指针 → 扫描最新 → 系统 Node」三级解析；startup.ps1 已动态解析
   - 更新后 `cat versions\current` 并确认该版本目录存在
2. **daemon 死亡全家桶停** → 按 §1 恢复（resurrect 必须用户终端跑，沙箱内 daemon 不持久）
3. **恢复后核 5m 快照** → 见 §1 恢复后必做清单

## 3. dsh-web / 任何服务 EADDRINUSE 端口循环

**症状**: PM2 某进程 waiting restart 循环，err log 报 `EADDRINUSE`；但端口 curl 是通的。

**根因**: 端口被孤儿进程占用（PM2 进程表外），PM2 restart 无效。2026-10-23 案例: daemon 死亡遗留孤儿占 3080。

**修复**:
```powershell
netstat -ano | findstr ":3080"        # 找 LISTENING 行的 PID（其他端口换端口号）
tasklist /FI "PID eq <PID>"           # 确认身份
taskkill /F /PID <PID>
# PM2 waiting restart 会自动拉起; 若已 errored 则 pm2 restart dsh-web
```
**教训**: 「端口通」≠「PM2 管理的进程在服务」。先对比占口 PID 与 `pm2 jlist` 里该进程的 pid。

## 4. schtasks 通道停摆（watchdog 救援失效）

**症状**: PM2 watchdog 告警「外部计划任务通道心跳过期/缺失」（heartbeat-task.json 超 30min 未更新）。
此时 PM2 daemon 死了将无人自动 resurrect。

**修复**: 任务计划程序里检查 watchdog 相关任务（状态/上次运行时间），或手动跑一次验证：
```powershell
& "C:\nodejs\node-v22.19.0-win-x64\node.exe" "E:\炼丹炉\WorkBuddy\巨量引擎监控\pm2-watchdog.cjs"
# 然后 monitor-data\heartbeat-task.json 时间戳应刷新
```
注: schtasks 查询/创建被 WorkBuddy 沙箱程序黑名单拦截，只能用户终端操作。

## 5. lark-cli / 飞书推送故障

| 报错 | 根因 | 处理 |
|---|---|---|
| `not_configured` | 缺 `HERMES_HOME` | .env 已配置 `C:\Users\HTF2026\AppData\Local\hermes`；确认进程 env 加载了 .env |
| `20140` 权限错误 | 非 user 会话跑 lark-cli | lark-cli 仅用户会话可用；WinSW/系统服务内必死。推送走 push-queue → relay-flush（PM2 托管） |
| `proxyconnect` 拒连 | daemon env 带代理变量 | relay/watchdog 进程 env 已清空 HTTP(S)_PROXY；新进程照抄 ecosystem 里同类写法 |
| 🔴 禁 `config init --new`、禁 `LARKSUITE_CLI_CONFIG_DIR` 变量 | 历史毒药操作 | 见 2026-09 记忆 |

**备选直发**: `src/feishu/direct-api.mjs`（OpenAPI，需 .env 里 LARK_BOT_APP_ID/LARK_BOT_APP_SECRET 明文；当前 SECRET 未配，guard 自动回落 lark-cli）。

## 6. git 沙箱 ref 坑

**症状**: WorkBuddy/CodeBuddy 沙箱会话内 `git push/fetch` 后 `origin/master [gone]`、refs 静默丢失。
**铁律**: 所有 push/fetch/远端操作在**用户终端**执行；沙箱内只做 add/commit/status/jlist 等本地或只读操作。

## 7. SQLite 备份与恢复

- 自动备份: `pm2-db-backup` 每日 23:45，better-sqlite3 在线备份 + integrity_check，存 `BACKUP_DIR`（当前 `D:\巨量引擎监控备份`），日 14 / 周 4 轮转
- **铁律**: DB 不要放 SMB/NAS 挂载上跑（WAL 锁不可靠）；NAS 备份用「本地 .backup 产物同步」模式
- 恢复:
```powershell
# 1. 停写入: pm2 stop 相关写库进程(calc-engine/pm2-5min/pm2-15min/action-queue-worker)
# 2. 换库: copy "D:\巨量引擎监控备份\oceanengine-<日期>.db" "monitor-data\oceanengine.db"
#          并删除 oceanengine.db-wal / -shm
# 3. 校验: node -e "new (require('better-sqlite3'))('monitor-data/oceanengine.db',{readonly:1}).pragma('integrity_check')"
# 4. pm2 start 恢复进程
```

## 8. 探活铁律（写代码时）

- Chrome 9222 / 本机服务探活一律写 `127.0.0.1`，**禁 `localhost`**（Node17+ 优先解析 ::1，Chrome 只听 IPv4 回环）
- PM2 daemon env 继承自 resurrect 时的终端，代理变量可能污染 → spawn 子进程 env 显式清空代理；网络探测用 Node 原生 http 不走 curl
- execFileSync 跑 `pm2 jlist` 必须 `maxBuffer: 16MB`（默认 1MB 会 ENOBUFS，2026-10-23 实测）
- 沙箱内 Git Bash 的 `taskkill /F` 要写 `taskkill //F`（MSYS 路径转换）；PowerShell 无此问题

---

## 附: 关键路径/事实速查

| 项 | 值 |
|---|---|
| 项目目录 | `E:\炼丹炉\WorkBuddy\巨量引擎监控` |
| DB | `monitor-data\oceanengine.db`（SQLite WAL） |
| 备份目录 | `D:\巨量引擎监控备份`（BACKUP_DIR） |
| Node | versions\current 指针；兜底 `C:\nodejs\node-v22.19.0-win-x64` |
| PM2 CLI | `C:\Users\HTF2026\.workbuddy\binaries\node\workspace\node_modules\pm2\bin\pm2` |
| PM2_HOME | `C:\Users\HTF2026\.pm2` |
| Chrome CDP | 9222 端口，`D:\ChromeCDP\User Data` Profile 4 |
| feedback-server | 127.0.0.1:8899（/health 探活） |
| dsh-web | 127.0.0.1:3080 |
| 账户 | 极狐-区域福利号-直播 ID 1842681352509635 |
| 飞书群 | 监控群=FEISHU_CHAT_ID(.env LARK_MONITOR_CHAT_ID) |
| 心跳文件 | `monitor-data\heartbeat-task.json`（schtasks 通道，30min 阈值） |
| 健康日报 | 23:50 `scripts\health-daily-report.mjs` → 监控群 |
| pm2 save | 每 30min（9,39 分）自动固化 |

## 9. 测试与告警降噪速查 (2026-10-23)

- 全量测试: `node --test tests/*.test.mjs`（**必须 glob 展开**，`--test tests` 会把目录当单模块跑）
- 已知基线失败 6 个（环境型，非回归）: csrf-http / action-queue-lock / ai-regions-core / daily-summary-core / feishu-listener-ai / shift-pusher-snapshot
- 告警降噪两层:
  1. `src/domain/alerts.mjs` dedupeRootCause — 根因互斥纯函数（budget 压 pacing_fast、speed_spike 压 medium pacing_fast）
  2. `src/services/alert-state.mjs` filterRecurringAlerts — type 级跨周期冷却 90min（severity 升级即时放行，类型消失重置），状态文件 `monitor-data/alert-state-generic.json`
  - 接入点: `monitor-push-send.mjs`（shouldPush 通过后过滤；冷却期内告警仍进卡片历史但不重复推送）
  - 调冷却时长: `filterRecurringAlerts` 默认 90min，可在 monitor-push.mjs createPushDeps 覆盖注入
