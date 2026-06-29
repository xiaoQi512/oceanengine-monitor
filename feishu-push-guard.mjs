// feishu-push-guard.mjs — 飞书推送的统一熔断/超时/成本守卫
// 职责：包装所有 lark-cli 推送调用，解决 "content is not valid JSON" 触发无限重试的问题。
//
// 设计约束：
// - 所有外部调用都有 timeout + retry cap + 失败记录。
// - lark-cli 本身不计 token 费用，但重试造成时间与 CPU 浪费，按执行时长近似成本。
// - 失败时先降级到本地日志/文件，保证监控主流程不中断。
// - 通过 telemetry 持久化评分数据。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Provider, AutonomousRouter } from './autonomous-router.mjs';
import { FEISHU_CHAT_ID, atomicWriteJSON, DATA_DIR } from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 默认守卫：lark-cli 调用失败率过高时立即熔断，避免 content-is-not-valid-JSON 重试风暴
const DEFAULT_OPTIONS = {
  maxRetries: 1,          // lark-cli 问题通常是内容格式，重试无意义，只给 1 次
  timeoutMs: 20000,       // 含 PS1 文件方式，给足 20s
  maxCostPerRun: 0.001,   // 本地 CLI 近似免费，但用来拦截异常超时
  circuitFailureThreshold: 2,
  circuitFailureWindow: 4,
  circuitOpenDurationMs: 60_000,
};

// 创建一个 lark-cli Provider（按实际 .exe/.cmd 选择）
export function createLarkProvider(larkCmd, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_OPTIONS.timeoutMs;
  const isExe = larkCmd.endsWith('.exe');

  async function larkExecutor({ args, content, cwd }) {
    if (!isExe && content && content.length > 2000) {
      // 非 .exe 且内容过长：写临时 .ps1 通过 PowerShell 传参，避免 shell 引号问题
      const tmpJson = path.join(DATA_DIR, '_push-card-guarded.json');
      const psFile = path.join(DATA_DIR, '_push-card.ps1');
      atomicWriteJSON(tmpJson, JSON.parse(content));
      const psScript = `$cardJson = Get-Content -Path '${tmpJson.replace(/'/g, "''")}' -Raw -Encoding UTF8\n& '${larkCmd.replace(/'/g, "''")}' ${args.join(' ')} --content $cardJson`;
      fs.writeFileSync(psFile, '\uFEFF' + psScript, 'utf-8');
      const result = spawnSync('powershell.exe', [
        '-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', psFile
      ], { timeout: timeoutMs + 5000, encoding: 'utf-8', windowsHide: true });
      return parseResult(result);
    }

    // .exe 直接传参：spawnSync 不经过 shell，无引号问题
    const finalArgs = content ? [...args, '--content', content] : args;
    const result = spawnSync(larkCmd, finalArgs, {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf-8',
      windowsHide: true,
    });
    return parseResult(result);
  }

  const provider = new Provider(
    'lark-cli',
    larkExecutor,
    {
      timeoutMs,
      costPerRun: 0,
      circuit: {
        failureThreshold: options.circuitFailureThreshold ?? DEFAULT_OPTIONS.circuitFailureThreshold,
        failureWindow: options.circuitFailureWindow ?? DEFAULT_OPTIONS.circuitFailureWindow,
        openDurationMs: options.circuitOpenDurationMs ?? DEFAULT_OPTIONS.circuitOpenDurationMs,
      },
    }
  );

  // 暴露原始 executor，便于测试替换
  provider.larkExecutor = larkExecutor;
  return provider;
}

function parseResult(result) {
  if (result.error) throw result.error;
  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();

  // lark-cli 偶发返回非 JSON；如包含常见错误关键字，直接视为失败
  if (stderr.includes('content is not valid JSON') ||
      stderr.includes('is not valid JSON') ||
      stdout.includes('content is not valid JSON')) {
    throw new Error(`LARK_INVALID_JSON: ${stderr || stdout}`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`LARK_NOT_JSON: ${stdout.slice(0, 200)}`);
  }

  if (!parsed.ok) {
    throw new Error(`LARK_API_ERROR: ${parsed.error?.message || JSON.stringify(parsed)}`);
  }

  // 保留 stdout/stderr 用于调试，但 data 才是下游真正需要的字段
  return { data: parsed.data, ok: parsed.ok, stdout, stderr };
}

// 静默日志 fallback：当 lark-cli 持续失败时，把消息写到本地，避免监控中断
function fallbackToLocalLog(payload, reason) {
  const dir = path.join(DATA_DIR, 'push-fallback');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `push-${Date.now()}.json`);
  atomicWriteJSON(file, {
    ts: new Date().toISOString(),
    reason: reason.message || String(reason),
    payload,
  });
  return { fallback: true, path: file };
}

// 统一推送入口
export async function guardedFeishuPush({ larkCmd, chatId = FEISHU_CHAT_ID, msgType, content, file, cwd, options = {} }) {
  if (!larkCmd) throw new Error('LARK_CLI_MISSING');

  const provider = createLarkProvider(larkCmd, options);
  const router = new AutonomousRouter([provider], { ...DEFAULT_OPTIONS, ...options });

  const baseArgs = ['im', '+messages-send', '--chat-id', chatId, '--msg-type', msgType];
  const args = file ? [...baseArgs, '--file', file] : baseArgs;

  try {
    const result = await router.route({ args, content, cwd });
    return { ok: true, ...result };
  } catch (e) {
    const fallback = fallbackToLocalLog({ chatId, msgType, content, file }, e);
    return { ok: false, error: e.message, ...fallback };
  }
}

// 便捷包装：文本消息
export async function pushText(larkCmd, text, chatId = FEISHU_CHAT_ID, options = {}) {
  const content = JSON.stringify({ text });
  return guardedFeishuPush({ larkCmd, chatId, msgType: 'text', content, options });
}

// 便捷包装：交互卡片
export async function pushCard(larkCmd, card, chatId = FEISHU_CHAT_ID, options = {}) {
  const content = typeof card === 'string' ? card : JSON.stringify(card);
  return guardedFeishuPush({ larkCmd, chatId, msgType: 'interactive', content, options });
}

// 便捷包装：文件消息
export async function pushFile(larkCmd, filePath, chatId = FEISHU_CHAT_ID, cwd = __dirname, options = {}) {
  const relFile = path.relative(cwd, filePath).replace(/\\/g, '/');
  return guardedFeishuPush({ larkCmd, chatId, msgType: 'file', file: relFile, cwd, options });
}

export default { guardedFeishuPush, pushText, pushCard, pushFile, createLarkProvider };
