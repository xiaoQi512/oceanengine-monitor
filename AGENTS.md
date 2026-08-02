

---

## 项目统一日志规范（强制）

任何 agent（Codex / CodeBuddy / WorkBuddy 等）对项目内容（代码 / 文档 / 配置 / 数据库 / 脚本）进行更改后，**必须**在统一日志中记录一条变更日志：

```
node scripts/log-change.mjs --agent <agent名> --reason "<调试原因>" --method "<执行方法>" --files "<变更文件，逗号分隔>" --result <done|partial|failed> [--tag <标签>]
```

- 必填：`--reason`（为什么改）、`--method`（怎么改的）、`--result`（done 完成 / partial 部分完成 / failed 失败）
- 建议：`--files` 列出变更文件；`--agent` 标注执行 agent（默认 unknown）
- 运行日志由 `logger.mjs` 自动写入**同一文件**：`monitor-data/logs/monitor-YYYY-MM-DD.ndjson`（结构化）+ `monitor-data/monitor.log`（纯文本聚合）
- 变更记录以 `[CHANGE]` 前缀标识；查询：`Select-String "[CHANGE]" monitor-data/monitor.log`

---

## 重构分层规范（过渡期强制）

依据《巨量引擎监控-完整方案整合文档_20260801.md》，生产代码逐步迁入 `src/`，依赖规则如下：

1. `src/platform/` 只依赖 `src/utils/` 与 `src/config/`
2. `src/domain/` 为纯业务逻辑，不 import `src/platform/`；外部数据通过参数注入
3. `src/services/` 只做编排，不写业务算法
4. 禁止跨层 import（如 `src/domain/` 直接调 `src/feishu/`）
5. 根目录旧文件在迁移期间仅作为兼容入口，新代码不再直接引用根目录业务模块
