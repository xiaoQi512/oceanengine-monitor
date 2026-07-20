// index.mjs - 巨量引擎快照数据库入口
// 统一导出所有快照数据库模块接口
//
// 用法:
//   import { getShiftDelta, getDailyShiftReport, getSnapshotStats } from './巨量引擎快照数据库/index.mjs';
//
// 测试:
//   node 巨量引擎快照数据库/index.mjs --test 2026-07-10

export {
  getShiftDelta,
  getDailyShiftReport,
  getSnapshotStats,
  getSnapshotAt,
  cstToUtc,
  MONITOR_DATA_DIR as snapDir,
} from './snapshot-db.mjs';

// 直接运行测试
if (process.argv.includes('--test')) {
  const dateStr = process.argv[process.argv.indexOf('--test') + 1]
    || new Date().toISOString().slice(0, 10);

  import('./snapshot-db.mjs').then(async (mod) => {
    console.log(`=== 巨量引擎快照数据库测试: ${dateStr} ===\n`);

    // 读取排班
    const fs = await import('node:fs');
    const path = await import('node:path');
    const shiftsFile = path.join(mod.MONITOR_DATA_DIR, `shifts-${dateStr}.json`);
    let shifts = [];

    if (fs.existsSync(shiftsFile)) {
      const cached = JSON.parse(fs.readFileSync(shiftsFile, 'utf-8'));
      shifts = cached.shifts || [];
    }

    if (shifts.length === 0) {
      console.log('⚠ 无排班数据，跳过场次计算');
    } else {
      let totalS = 0, totalL = 0;
      for (const shift of shifts) {
        try {
          const delta = await mod.getShiftDelta(dateStr, shift);
          totalS += delta.spend; totalL += delta.leads;
          const tag = delta.fromCache ? '快照' : 'API';
          console.log(`${shift.label}: ¥${delta.spend.toFixed(2)} / ${delta.leads}线索 / CPL¥${delta.cpl} [${tag}]`);
          if (delta.detail?.startSnapshot) {
            console.log(`  ${delta.detail.startSnapshot} → ${delta.detail.endSnapshot}`);
          }
        } catch (e) {
          console.log(`${shift.label}: ⚠ ${e.message}`);
        }
      }
      console.log(`\n${shifts.length}场合计: ¥${totalS.toFixed(2)} / ${totalL}线索`);
    }

    // 快照统计
    const stats = mod.getSnapshotStats();
    console.log(`\n快照文件: ${stats.total5m}个5分钟 + ${stats.total15m}个15分钟 (${stats.sizeMB}MB)`);
    console.log(`覆盖日期: ${stats.dateRange[0] || '无'} ~ ${stats.dateRange[stats.dateRange.length-1] || '无'}`);
  });
}
