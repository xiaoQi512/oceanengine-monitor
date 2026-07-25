#!/usr/bin/env bash
# 巨量引擎监控 · 代码量统计脚本
# 用法: bash scripts/count-lines.sh
#        bash scripts/count-lines.sh --markdown  (输出 README 格式)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

# 跳过数据/依赖目录
skip_dirs() {
  sed '/node_modules/d; /monitor-data/d; /\.git/d; /push-fallback/d'
}

count_ext() {
  local ext="$1"
  find . -name "*.$ext" -type f 2>/dev/null | skip_dirs | while read f; do cat "$f"; done | wc -l
}
file_count() {
  local ext="$1"
  find . -name "*.$ext" -type f 2>/dev/null | skip_dirs | wc -l
}

if [ "${1:-}" = "--markdown" ]; then
  echo "## 代码量统计"
  echo ""
  echo "| 类型  | 文件数 | 行数   | 说明 |"
  echo "|-------|--------|--------|------|"
  echo "| .mjs  | $(file_count mjs) | $(count_ext mjs) | Node.js 核心脚本 (监控/推送/API) |"
  echo "| .py   | $(file_count py) | $(count_ext py) | 多 Agent 编排脚本 |"
  echo "| .html | $(file_count html) | $(count_ext html) | Dashboard 页面模板 |"
  echo "| .md   | $(file_count md) | $(count_ext md) | 文档/规范/Prompts |"
  echo "| .js   | $(file_count js) | $(count_ext js) | JS 源文件 |"
  echo "| .sql  | $(file_count sql) | $(count_ext sql) | 数据库迁移脚本 |"
  echo "| .ps1  | $(file_count ps1) | $(count_ext ps1) | PowerShell 维护脚本 |"
  echo "| .sh   | $(file_count sh) | $(count_ext sh) | Shell 辅助脚本 |"
  echo "| .css  | $(file_count css) | $(count_ext css) | Dashboard 样式 |"
  echo "| .xml  | $(file_count xml) | $(count_ext xml) | 配置文件 |"
  echo ""

  # 总计 (只统计 .mjs 和 .py 核心代码，排除过大 json/md)
  core=$(($(count_ext mjs) + $(count_ext py)))
  f=$(($(file_count mjs) + $(file_count py)))
  echo "> **核心代码**: .mjs + .py = $f 个文件 · $core 行"
  echo "> 统计时间: $(date '+%Y-%m-%d %H:%M') · 不含 node_modules / monitor-data / .git"
else
  echo "=== 巨量引擎监控 · 代码量统计 ==="
  echo "  统计时间: $(date '+%Y-%m-%d %H:%M')"
  echo ""
  for ext in mjs py html md js sql ps1 sh css xml; do
    cnt=$(count_ext "$ext")
    [ "$cnt" -gt 0 ] && printf "  %-6s %8s 行\n" ".$ext" "$cnt"
  done
  echo ""
  core=$(($(count_ext mjs) + $(count_ext py)))
  echo "  核心代码 (.mjs + .py): $core 行"
fi
