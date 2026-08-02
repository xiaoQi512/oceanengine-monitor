// tests/campaign-index.test.mjs - 计划索引测试
import assert from 'node:assert';
import { buildCampaignIndex } from '../src/domain/campaign-index.mjs';

const index = buildCampaignIndex([{ id: 'a', name: '计划A' }]);
assert.strictEqual(index.get('a').name, '计划A');
assert.strictEqual(index.get('missing'), undefined);

console.log('\n全部测试通过');
