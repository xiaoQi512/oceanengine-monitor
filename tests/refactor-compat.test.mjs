// tests/refactor-compat.test.mjs - 校验重构兼容入口与配置单一来源
import assert from 'node:assert';

async function testDefaultExports() {
  const cdp = await import('../cdp-client.mjs');
  const wait = await import('../wait-utils.mjs');
  const router = await import('../autonomous-router.mjs');
  const feishu = await import('../feishu-push-guard.mjs');
  const api = await import('../oceanengine-api-client.mjs');
  const login = await import('../oec-auto-login.mjs');
  const action = await import('../cdp-action.mjs');

  assert.strictEqual(typeof cdp.default, 'object', 'cdp-client 默认导出应保留');
  assert.strictEqual(typeof wait.default, 'object', 'wait-utils 默认导出应保留');
  assert.strictEqual(typeof router.default, 'object', 'autonomous-router 默认导出应保留');
  assert.strictEqual(typeof feishu.default, 'object', 'feishu-push-guard 默认导出应保留');
  assert.strictEqual(typeof api.default, 'object', 'oceanengine-api-client 默认导出应保留');
  assert.strictEqual(typeof login.default, 'object', 'oec-auto-login 默认导出应保留');
  assert.strictEqual(typeof action.default, 'object', 'cdp-action 默认导出应保留');
  console.log('✅ 默认导出兼容');
}

async function testConfigSingleSource() {
  const config = await import('../src/config/index.mjs');
  const utils = await import('../src/utils/monitor-utils.mjs');

  assert.strictEqual(config.ACCOUNT_ID, utils.ACCOUNT_ID, 'ACCOUNT_ID 应来自 src/config');
  assert.strictEqual(config.VIDEO_ACCOUNT_ID, utils.VIDEO_ACCOUNT_ID, 'VIDEO_ACCOUNT_ID 应来自 src/config');
  assert.strictEqual(config.FEISHU_CHAT_ID, utils.FEISHU_CHAT_ID, 'FEISHU_CHAT_ID 应来自 src/config');
  assert.strictEqual(config.FEISHU_ANCHOR_CHAT_ID, utils.FEISHU_ANCHOR_CHAT_ID, 'FEISHU_ANCHOR_CHAT_ID 应来自 src/config');
  assert.strictEqual(config.DEFAULT_ACCOUNT.accountId, config.ACCOUNT_ID, 'DEFAULT_ACCOUNT 与 ACCOUNT_ID 不应分叉');
  assert.strictEqual(config.DEFAULT_ACCOUNT.monitorChatId, config.FEISHU_CHAT_ID, 'DEFAULT_ACCOUNT 与 FEISHU_CHAT_ID 不应分叉');
  assert.strictEqual(config.ACCOUNTS.length, 1, 'accounts.json 应包含默认账户');
  assert.strictEqual(config.validateConfig().ok, true, '配置校验应通过');
  console.log('✅ 配置单一来源');
}

async function testCronImportSafe() {
  const crons = await Promise.all([
    import('../src/services/cron-daily-report.mjs'),
    import('../src/services/cron-daily-summary.mjs'),
    import('../src/services/cron-sync-shifts.mjs'),
    import('../src/services/cron-ai-regions.mjs'),
  ]);
  for (const mod of crons) {
    assert.strictEqual(typeof mod.runCli, 'function', 'cron 应导出 runCli');
  }
  console.log('✅ cron 导入安全');
}

async function testMonitorImportSafe() {
  const monitors = await Promise.all([
    import('../src/services/monitor-5min.mjs'),
    import('../src/services/monitor-15min.mjs'),
  ]);
  for (const mod of monitors) {
    assert.strictEqual(typeof mod.runCli, 'function', '监控服务应导出 runCli');
  }
  console.log('✅ monitor 导入安全');
}

async function testDbUnifiedEntry() {
  const db = await import('../src/db/index.mjs');
  const dual = await import('../src/db/dual-write.mjs');
  assert.strictEqual(typeof db.insertSnapshot, 'function', '统一入口应暴露 insertSnapshot');
  assert.strictEqual(typeof db.refreshMaterialized, 'function', '统一入口应暴露 refreshMaterialized');
  assert.strictEqual(typeof db.v2.connect, 'function', '统一入口应暴露 v2 命名空间');
  assert.strictEqual(typeof db.v2Compat.insertSnapshot, 'function', '统一入口应暴露 v2 兼容写入层');
  assert.strictEqual(typeof db.legacy.insertSnapshot, 'function', '统一入口应暴露 legacy 旧 writer');
  assert.strictEqual(typeof dual.dualInsertSnapshot, 'function', 'dual-write 应暴露 dualInsertSnapshot');
  assert.strictEqual(typeof dual.dualInsertAction, 'function', 'dual-write 应暴露 dualInsertAction');
  console.log('✅ 数据库统一入口');
}

async function testDbWriteModes() {
  const dual = await import('../src/db/dual-write.mjs');
  const oldDual = process.env.DB_V2_DUAL_WRITE;
  const oldPrimary = process.env.DB_V2_PRIMARY;

  process.env.DB_V2_DUAL_WRITE = '1';
  process.env.DB_V2_PRIMARY = '1';
  assert.strictEqual(dual.v2PrimaryEnabled(), true, 'DB_V2_PRIMARY=1 应启用 v2 主写');

  process.env.DB_V2_PRIMARY = '0';
  assert.strictEqual(dual.v2PrimaryEnabled(), false, 'DB_V2_PRIMARY=0 应保留旧 writer 主写');

  delete process.env.DB_V2_PRIMARY;
  assert.strictEqual(dual.v2PrimaryEnabled(), true, '未设置时默认应启用 v2 主写');

  process.env.DB_V2_DUAL_WRITE = oldDual;
  process.env.DB_V2_PRIMARY = oldPrimary;
  console.log('✅ 数据库写入模式开关');
}

async function run() {
  await testDefaultExports();
  await testConfigSingleSource();
  await testCronImportSafe();
  await testMonitorImportSafe();
  await testDbUnifiedEntry();
  await testDbWriteModes();
  console.log('\n全部测试通过');
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
