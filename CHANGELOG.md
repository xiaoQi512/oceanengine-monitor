# 巨量引擎监控 · 更新日志

> 从项目初始化到当前版本的完整演进记录
> 共 26 个 commit，4 个大版本

---

## v0.1 — 项目初始化（2026-06-29）

**4 commits**

| commit | 内容 |
|--------|------|
| `cef74b2` | init repo for multi-agent pipeline |
| `911aef8` | exclude large data dirs from git |
| `1075e58` | add opencode.json for v5 test |
| `ff6e5da` | add fixer agent config |

基础设施搭建，配置多 agent 协作工作流。

---

## v0.2 — 基础监控框架（2026-07-19 ~ 07-20）

**2 commits**

| commit | 内容 |
|--------|------|
| `99056b2` | 日汇总去重 + 双群@监听 + 车型贝塔S3 + 动态等待恢复 |
| `f75c0c2` | 卡片格式重构 + Node22 规范 + 代码审查修复 |

**建立的能力**：
- 15 分钟飞书卡片推送（消耗/转化/CPM 等核心指标）
- 双群（监控群 + 主播群）消息监听
- 日汇总推送（去重逻辑）
- 直播车型识别（贝塔 S3 等）

---

## v0.3 — CI/备份验证（2026-07-26）

**3 commits**

| commit | 内容 |
|--------|------|
| `9655c4a` | 备份验证脚本 + 工程化优化方案 + CI 工作流 |
| `5b0cb09` | 验收清单更新 - CI backup-verify 线上跑通 |
| `57f4f33` | README 添加 CI 徽章 |
| `d97a528` | 5min-card: CPM 标签与窗口对齐消耗/转化行 |

**建立的能力**：
- GitHub Actions CI 流水线
- 数据库备份验证自动化
- 5 分钟速报卡片
- 工程化优化方案文档

---

## v1.0 — 稳定运行版（2026-07-27 上午 ~ 晚上）

**6 commits（v1.0基础 + P0 阶段）**

| commit | 内容 |
|--------|------|
| `4d6f844` | v1.1 运行版本 — 四层架构 + API 逆向 + feishu-listener 改造 |

**建立的能力**：
- **四层架构方案**：D1-D7 决策档案（审计归一/重复确认/熔断/Dashboard/卡片化/枚举统一）
- **oceanengine-api-client.mjs**：HTTP API 客户端（getDashboardStats/pause/resume/budget/bid）
- **feishu-listener.mjs**：@回复 Get 表情 + 去掉思考中 + AI 数据注入
- **oceanengine-monitor-v3.mjs**：计划名截断 15→30 字
- API 逆向脚本：oec-reverse-status-api.mjs / oec-reverse-stats-api.mjs

---

## v1.1 — 四层架构实施（2026-07-27 晚上 ~ 07-28 凌晨）

**10 commits（P0 + P1 + P2 + 修补 ×3）**

### P0 阶段（D1-D7）
| commit | 内容 |
|--------|------|
| `e10d9d7` | 审计归一 + 重复指令确认 + pending 扫描 + 单实例约束 |
| `eca7c34` | P0 审查修补（语法阻塞 + 确认闭环 + actionType 映射 + 路径常量） |

**能力**：操作审计归一化 / 飞书重复指令二次确认 / 30s pending 超时扫描 / 操作队列

### P1 阶段（D3/D5/D6）
| commit | 内容 |
|--------|------|
| `b5b7d94` | CDP 熔断 + Dashboard 三 tab 面板 + ACK 卡片化 + source 枚举 |
| `25e36de` | P1 审查修补（failed 跳过 + Alpine 标准用法 + NaN 防护 + 卡片 tempId） |

**能力**：Chrome 9222 端口健康检测 / Dashboard 队列/pending/审计面板 / 飞书交互卡片 / source 枚举 auto/manual/dashboard/feishu

### P2 阶段（D7 审计扩展 + 回滚）
| commit | 内容 |
|--------|------|
| `783bb28` | afterValue 回读 + Dashboard 一键回滚 |
| `151d883` | P2 审查修补（beforeValue 回读 + rollback 校验分类 + 超时保护） |

**能力**：操作后 API 回读真实状态 / beforeValue/afterValue 完整链路 / Dashboard 审计 tab 回滚按钮

---

## v1.2 — 双路径执行 + 诊断规则（2026-07-28）

**5 commits**

| commit | 内容 |
|--------|------|
| `a47d173` | 监控新增计划状态变化检测（投放中→超出预算） |
| `eb88863` | 新增 AI 自动诊断规则手册（Rule-001 直播间消耗节奏基线校准） |
| `e51dc89` | 诊断规则明确边界 — 仅诊断标注，不输出操作建议 |
| `677e8f4` | HTTP API 主方案 + CDP 降级 — 解决 CDP 文本搜索计划未找到 |
| `e9ee628` | worker 防御 UTF-8 编码损坏 |
| `2266bd9` | 5分钟速报卡片增加 CPL 指标展示 |

**能力**：
- **双路径执行**：HTTP API 主方案（projectId 精准调用）→ CDP 降级兜底
- **AI 诊断规则**：15 天+1 个月消耗节奏基线校准，5 级节奏分级，CPL 联动
- **UTF-8 防御**：检测 curl 编码损坏的计划名并拒绝执行
- **计划状态追踪**：投放中→超出预算 自动检测

---

## v1.3 — API 文档化 + browser-skill（2026-07-29 ~ 07-30）

**4 commits**

| commit | 内容 |
|--------|------|
| `60dab92` | API 字段全量档案 — 6 个端点 130+ 字段归纳 |
| `3d821cd` | 40102 拦截端点逆向思路 — 3 端点根因+4 方案+突破路径 |
| `ae8414e` | 补充直播分析页替代数据源路径 |
| `469f7ef` | 直播分析页 19 字段归档 — 替代 live_room/list 端点 |

**探索成果**：
- 安装并配置 browser-skill（bsk CLI + Chrome 扩展）
- 使用 bsk 读回巨量引擎页面 DOM 数据
- 直播分析页 URL 和 12 列表格字段全量识别
- 直播大屏实时数据（观看/停留/转化漏斗/用户画像/互动趋势）
- 40102 根因确认：页面级私有 CSRF token vs Cookie 级公开 token

---

## 版本能力矩阵

| 能力 | v0.1 | v0.2 | v0.3 | v1.0 | v1.1 | v1.2 | v1.3 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 15 分钟飞书卡片 | | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5 分钟速报卡片 | | | ✅ | ✅ | ✅ | ✅ | ✅ |
| 日汇总推送 | | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 双群消息监听 | | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| CI/CD 工作流 | | | ✅ | ✅ | ✅ | ✅ | ✅ |
| DB 备份验证 | | | | ✅ | ✅ | ✅ | ✅ |
| HTTP API 客户端 | | | | ✅ | ✅ | ✅ | ✅ |
| 飞书操作指令 | | | | ✅ | ✅ | ✅ | ✅ |
| 操作队列 worker | | | | | ✅ | ✅ | ✅ |
| 审计日志 (before/after) | | | | | ✅ | ✅ | ✅ |
| 重复指令二次确认 | | | | | ✅ | ✅ | ✅ |
| CDP 熔断 | | | | | ✅ | ✅ | ✅ |
| Dashboard 操作面板 | | | | | ✅ | ✅ | ✅ |
| 飞书 ACK 卡片 | | | | | | ✅ | ✅ |
| 双路径执行 (API+CDP) | | | | | | ✅ | ✅ |
| AI 诊断规则 | | | | | | ✅ | ✅ |
| API 字段全量档案 | | | | | | | ✅ |
| browser-skill 集成 | | | | | | | ✅ |
| 直播大屏 DOM 数据 | | | | | | | ✅ |

---

## 文件清单

| 文件 | 版本引入 | 用途 |
|------|:---:|------|
| `oceanengine-monitor-v3.mjs` | v0.2 | 核心监控：5分钟快照 + 飞书卡片推送 |
| `feishu-listener.mjs` | v0.2 | 飞书双群消息监听 + 操作指令分发 |
| `action-queue-worker.mjs` | v1.1 | 操作队列串行 worker + 双路径执行 |
| `oceanengine-api-client.mjs` | v1.0 | HTTP API 客户端（Cookie 管理 + 12 个端点） |
| `cdp-action.mjs` | v0.2 | CDP 浏览器自动化（搜索/暂停/预算/出价） |
| `feedback-server.mjs` | v0.2 | 本地 HTTP 服务（端口 8899）+ Dashboard |
| `db/schema.sql` | v0.1 | SQLite 数据库 6 张基础表 |
| `db/writer.mjs` | v0.1 | 快照写入器 |
| `API字段全量档案.md` | v1.3 | 8 端点 149 字段全量归档 |
| `AI诊断规则手册.md` | v1.2 | Rule-001 消耗节奏基线校准 |
| `广告计划调整_四层架构方案_v1.1_决策档案_20260727.md` | v1.0 | D1-D7 十项决策文档 |
| `40102端点逆向思路.md` | v1.3 | 3 个 40102 拦截端点的根因和突破路径 |
