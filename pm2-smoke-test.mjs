// pm2-smoke-test.mjs — PM2 迁移冒烟测试
// 在不影响现有 Windows 任务计划的情况下，并行验证 PM2 模式下各脚本的数据采集和推送能力
// 推送消息标注 "🧪 [PM2模式测试]" 前缀，与正式推送区分
//
// 用法:
//   OEC_FORCE=1 node pm2-smoke-test.mjs          → 全量测试（采集+推送）
//   OEC_FORCE=1 OEC_DRY_RUN=1 node pm2-smoke-test.mjs  → 只采集不推送
//   pm2 start ecosystem.config.cjs --only smoke-test   → PM2 常驻（cron 触发）

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient, getHourlyStats, getDashboardStats } from './oceanengine-api-client.mjs';
import { findLarkCli, DATA_DIR, FEISHU_CHAT_ID, getLocalDate } from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === '1';
const NODE = process.execPath;

// 测试专用群（与正式群相同，但消息带标记）
const TEST_CHAT_ID = 'oc_b245ee4b255c7b25b7f8d953802c49ff';
const TEST_PREFIX = '🧪 [PM2模式测试]';

function log(...args) { console.log(`[smoke-test] ${new Date().toLocaleString()} |`, ...args); }

// ====== 依赖检查 ======
async function checkDeps() {
  const results = {};
  
  // 1. Chrome CDP 9222
  results.chromeCDP = await new Promise(resolve => {
    const req = http.get('http://localhost:9222/json/version', { timeout: 3000 }, res => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });

  // 2. CDP proxy 3456
  results.cdpProxy = await new Promise(resolve => {
    const req = http.get('http://localhost:3456/targets', { timeout: 3000 }, res => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });

  // 3. lark-cli
  results.larkCli = !!findLarkCli();

  // 4. Cookie 文件
  const cookieFile = path.join(DATA_DIR, '.oec-cookies.json');
  results.cookie = fs.existsSync(cookieFile);

  // 5. feedback-server 8899
  results.feedback = await new Promise(resolve => {
    const req = http.get('http://127.0.0.1:8899/health', { timeout: 3000 }, res => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });

  return results;
}

// ====== lark-cli 推送（带测试标记）======
function pushTestMessage(text) {
  const larkCli = findLarkCli();
  if (!larkCli) { log('⚠ lark-cli 不可用'); return false; }
  const msgText = `${TEST_PREFIX}\n${text}`;
  const isExe = larkCli.endsWith('.exe');
  const args = ['im', '+messages-send', '--chat-id', TEST_CHAT_ID, '--text', msgText, '--as', 'bot'];
  try {
    const result = execFileSync(
      isExe ? larkCli : 'cmd.exe',
      isExe ? args : ['/c', larkCli, ...args],
      { encoding: 'utf-8', timeout: 20000, windowsHide: true, cwd: __dirname }
    );
    const parsed = JSON.parse(result);
    return parsed.ok;
  } catch (e) {
    log('❌ 推送失败:', e.message);
    return false;
  }
}

// ====== 测试 1: HTTP API 数据采集（shift-pusher 使用的路径）======
async function testHttpApi() {
  log('━━━ 测试1: HTTP API 数据采集 ━━━');
  try {
    const client = await createClient({ useCache: true });
    const today = getLocalDate();
    const hour = new Date().getHours();
    const startHour = Math.max(0, hour - 2);
    const endHour = Math.max(1, hour - 1);
    
    log(`  拉取 ${today} ${startHour}:00 - ${endHour + 1}:00 数据...`);
    const result = await getHourlyStats(client, { startHour, endHour });
    
    if (!result.rows || result.rows.length === 0) {
      log('  ⚠ API 返回空数据（可能非投放时段）');
      return { ok: true, note: '空数据（正常）', rows: 0 };
    }

    let totalCost = 0, totalLeads = 0;
    for (const row of result.rows) {
      const cost = parseFloat((row.metrics?.stat_cost?.valueStr || '0').replace(/,/g, '')) || 0;
      const leads = parseInt((row.metrics?.convert_cnt?.valueStr || '0').replace(/,/g, '')) || 0;
      totalCost += cost;
      totalLeads += leads;
      log(`  ${row.hour}: ¥${cost.toFixed(2)} / ${leads}线索`);
    }
    log(`  ✅ 采集成功: 共${result.rows.length}行, 总消耗¥${totalCost.toFixed(2)}`);
    return { ok: true, totalCost, totalLeads, rows: result.rows.length };
  } catch (e) {
    log(`  ❌ 失败: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ====== 测试 2: 5分钟速报脚本（DRY_RUN）======
async function test5minScript() {
  log('━━━ 测试2: 5分钟速报脚本 (DRY_RUN) ━━━');
  try {
    const script = path.join(__dirname, 'oceanengine-5min-check.mjs');
    if (!fs.existsSync(script)) { log('  ⚠ 脚本不存在'); return { ok: false }; }
    
    const out = execSync(`"${NODE}" "${script}"`, {
      cwd: __dirname, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, OEC_FORCE: '1', OEC_DRY_RUN: '1', OEC_SILENT: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    log('  ✅ 脚本执行完成');
    const hasData = out.includes('OEC_DRY_RUN') || out.includes('消耗') || out.includes('cookie');
    return { ok: true, hasData, output: out.slice(-200) };
  } catch (e) {
    log(`  ❌ 失败: ${e.message.slice(0, 100)}`);
    return { ok: false, error: e.message.slice(0, 100) };
  }
}

// ====== 测试 3: 15分钟监控脚本（DRY_RUN）======
async function test15minScript() {
  log('━━━ 测试3: 15分钟监控脚本 (DRY_RUN) ━━━');
  try {
    const script = path.join(__dirname, 'oceanengine-monitor-v3.mjs');
    if (!fs.existsSync(script)) { log('  ⚠ 脚本不存在'); return { ok: false }; }
    
    const out = execSync(`"${NODE}" "${script}"`, {
      cwd: __dirname, encoding: 'utf-8', timeout: 60000,
      env: { ...process.env, OEC_DRY_RUN: '1', OEC_SILENT: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    log('  ✅ 脚本执行完成');
    return { ok: true, output: out.slice(-200) };
  } catch (e) {
    log(`  ❌ 失败: ${e.message.slice(0, 100)}`);
    return { ok: false, error: e.message.slice(0, 100) };
  }
}

// ====== 测试 4: 日汇总数据采集（从 API 直接拉全天）======
async function testDailySummary() {
  log('━━━ 测试4: 日汇总数据采集 ━━━');
  try {
    const client = await createClient({ useCache: true });
    const result = await getHourlyStats(client, {}); // 全天
    const rows = result.rows || [];
    let totalCost = 0, totalLeads = 0;
    for (const row of rows) {
      const cost = parseFloat((row.metrics?.stat_cost?.valueStr || '0').replace(/,/g, '')) || 0;
      const leads = parseInt((row.metrics?.convert_cnt?.valueStr || '0').replace(/,/g, '')) || 0;
      totalCost += cost;
      totalLeads += leads;
    }
    const cpl = totalLeads > 0 ? (totalCost / totalLeads).toFixed(2) : '0.00';
    log(`  ✅ 全天${rows.length}行: 消耗¥${totalCost.toFixed(2)} 线索${totalLeads} CPL¥${cpl}`);
    return { ok: true, totalCost, totalLeads, cpl, rows: rows.length };
  } catch (e) {
    log(`  ❌ 失败: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ====== 主流程 ======
async function main() {
  log('🚀 PM2 迁移冒烟测试启动');
  log(`   模式: ${OEC_DRY_RUN ? 'DRY_RUN (不推送)' : '全量 (含推送)'}`);

  // 0. 依赖检查
  log('━━━ 依赖检查 ━━━');
  const deps = await checkDeps();
  const depSummary = Object.entries(deps).map(([k, v]) => `${k}:${v ? '✅' : '❌'}`).join(' ');
  log(`  ${depSummary}`);

  // 1. HTTP API
  const apiResult = await testHttpApi();

  // 2. 5min 脚本
  const min5Result = await test5minScript();

  // 3. 15min 脚本
  const min15Result = await test15minScript();

  // 4. 日汇总数据
  const dailyResult = await testDailySummary();

  // 5. 汇总报告
  log('━━━ 测试汇总 ━━━');
  const tests = [
    { name: '依赖检查', ok: Object.values(deps).every(Boolean) },
    { name: 'HTTP API', ok: apiResult.ok },
    { name: '5min脚本', ok: min5Result.ok },
    { name: '15min脚本', ok: min15Result.ok },
    { name: '日汇总采集', ok: dailyResult.ok },
  ];
  tests.forEach(t => log(`  ${t.ok ? '✅' : '❌'} ${t.name}`));
  const allOk = tests.every(t => t.ok);
  log(`  总结果: ${allOk ? '✅ 全部通过' : '⚠ 部分失败'}`);

  // 6. 推送测试消息到飞书群
  if (!OEC_DRY_RUN) {
    const lines = [
      `PM2 迁移冒烟测试报告`,
      `时间: ${new Date().toLocaleString()}`,
      ``,
      `依赖: ${depSummary}`,
      ``,
      `HTTP API: ${apiResult.ok ? '✅' : '❌'} ${apiResult.totalCost ? '消耗¥' + apiResult.totalCost.toFixed(0) : ''}`,
      `5min脚本: ${min5Result.ok ? '✅' : '❌'}`,
      `15min脚本: ${min15Result.ok ? '✅' : '❌'}`,
      `日汇总: ${dailyResult.ok ? '✅' : '❌'} ${dailyResult.totalCost ? '消耗¥' + dailyResult.totalCost.toFixed(0) + '/CPL¥' + dailyResult.cpl : ''}`,
      ``,
      `总结果: ${allOk ? '✅ 全部通过' : '⚠ 部分失败'}`,
    ];
    const ok = pushTestMessage(lines.join('\n'));
    log(`  推送测试消息: ${ok ? '✅' : '❌'}`);
  } else {
    log('  🧪 OEC_DRY_RUN=1，跳过推送');
  }

  log('🏁 冒烟测试完成');
  process.exit(0);
}

main().catch(e => {
  log('FATAL:', e.message, e.stack);
  process.exit(1);
});
