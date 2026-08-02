# 项目规则

所有强制规则以根目录 `AGENTS.md` 为准。

开始修改或使用本项目前，必须先读取：

- `AGENTS.md`：统一日志规范、重构分层规范、中文回复要求
- `docs/REFACTOR_STATUS.md`：当前重构进度与模块边界
- `docs/更新日志_v2.0.3_20260802.md`：v2.0.3 上线封版说明

修改代码后必须运行：

```bash
node scripts/ci-test.mjs
```

并记录统一变更日志：

```bash
node scripts/log-change.mjs --agent <agent名> --reason "<原因>" --method "<方法>" --files "<变更文件>" --result done
```
