// cron-sync-shifts.mjs - 次日排班同步入口
// 核心逻辑位于 shift-sync.mjs
import { runMonitorCli } from './monitor-cli.mjs';
import { getTomorrowDate, fetchShifts, saveCache } from './shift-sync.mjs';

async function main() {
  console.log('[sync-tomorrow] ' + new Date().toLocaleString() + ' | 开始同步次日排班...');
  const tomorrow = getTomorrowDate();
  console.log('[sync-tomorrow] 目标日期: ' + tomorrow);
  const data = fetchShifts(tomorrow);
  const ok = saveCache(tomorrow, data);
  if (!ok) throw new Error(`缓存写入失败: monitor-data/shifts-${tomorrow}.json`);
  console.log('[sync-tomorrow] ✅ 同步成功: ' + data.startTime + '-' + data.endTime + ' (' + data.shifts.length + '个班次)');
  console.log('[sync-tomorrow]    缓存: monitor-data/shifts-' + tomorrow + '.json');
  for (const s of data.shifts) {
    console.log('[sync-tomorrow]    ' + s.label + ' -> ' + (s.anchorName || '(无主播名)'));
  }
}

export function runCli() {
  runMonitorCli({ run: main });
}
