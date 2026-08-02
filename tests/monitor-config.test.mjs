// tests/monitor-config.test.mjs - 15min 监控配置基础测试
import assert from 'node:assert';
import { CONFIG } from '../src/services/monitor-config.mjs';

assert.strictEqual(CONFIG.enableHtmlReport, false);
assert.strictEqual(CONFIG.pageSize, 100);
assert.strictEqual(CONFIG.thresholds.speedFast, 1.5);
assert.strictEqual(CONFIG.thresholds.budgetDanger, 0.92);
assert.ok(CONFIG.dataDir.includes('monitor-data'));
assert.ok(CONFIG.feishuChatId.length > 0);
assert.ok('larkCli' in CONFIG);

console.log('\n全部测试通过');
