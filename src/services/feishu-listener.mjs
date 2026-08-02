// feishu-listener.mjs - 飞书群消息监听入口
// 主循环编排位于 feishu-listener-run.mjs
import { runMonitorCli } from './monitor-cli.mjs';
import { runListener } from './feishu-listener-run.mjs';

async function main() {
  await runListener();
}

export function runCli() {
  runMonitorCli({ run: main });
}
