

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
