// live-watcher.mjs - 直播间状态监听入口
// 运行编排位于 live-watcher-run.mjs
import { runMonitorCli } from './monitor-cli.mjs';
import { runLiveWatcher } from './live-watcher-run.mjs';

export function runCli() {
  runMonitorCli({ run: runLiveWatcher });
}
