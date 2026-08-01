// scripts/log-change.mjs — 统一项目变更日志记录工具
// 用法（任何 agent 修改项目后必须执行）：
//   node scripts/log-change.mjs --agent codex --reason "修复X" --method "修改了file.mjs" --files "a.mjs,b.mjs" --result done [--tag v1.1]
//   node scripts/log-change.mjs --agent codex --reason "调试Y" --method "运行 z.mjs 验证" --result failed
// 结果枚举：done（完成）/ partial（部分完成）/ failed（失败未完成）
import { writeChange } from '../logger.mjs';

const args = process.argv.slice(2);
function get(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : '';
}

const agent = get('agent') || process.env.AGENT || 'unknown';
const reason = get('reason');
const method = get('method');
const files = get('files').split(',').map(s => s.trim()).filter(Boolean);
const result = get('result') || 'done';
const tag = get('tag');

const missing = [];
if (!reason) missing.push('--reason');
if (!method) missing.push('--method');
if (missing.length) {
  console.error('缺少必填参数: ' + missing.join(', '));
  console.error('用法: node scripts/log-change.mjs --agent <agent> --reason <调试原因> --method <执行方法> [--files a,b] --result done|partial|failed [--tag xxx]');
  process.exit(1);
}

const rec = writeChange({ agent, reason, method, files, result, tag });
console.log('[log-change] 已记录: agent=' + rec.agent + ' 结果=' + rec.result + ' ts=' + rec.ts);
