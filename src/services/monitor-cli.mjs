// src/services/monitor-cli.mjs - 通用命令行运行与错误处理

export async function runMonitorCli({
  run,
  onSuccess,
  onError,
  onExit = code => process.exit(code),
}) {
  try {
    const result = await run();
    if (onSuccess) await onSuccess(result);
  } catch (e) {
    const msg = e.message || String(e);
    const stackLines = (e.stack || '').split('\n').slice(0, 4).map(l => l.trim()).join(' | ');
    console.error('❌ 错误:', msg);
    console.error('📍 堆栈:', stackLines);
    if (onError) {
      try { await onError(msg); } catch {}
    }
    onExit(1);
  }
}
