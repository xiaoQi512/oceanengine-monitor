# 项目规则

本项目的所有强制规则以根目录 `AGENTS.md` 为准。

修改代码、文档、配置、数据库或脚本前，请先读取：

- `AGENTS.md`
- `docs/REFACTOR_STATUS.md`
- `docs/更新日志_v2.0.1_20260802.md`

修改后请运行：

```bash
node scripts/ci-test.mjs
```

并记录统一变更日志：

```bash
node scripts/log-change.mjs --agent <agent名> --reason "<原因>" --method "<方法>" --files "<变更文件>" --result done
```
