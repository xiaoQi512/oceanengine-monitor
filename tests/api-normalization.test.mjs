// tests/api-normalization.test.mjs - API 归一化测试
import assert from 'node:assert';
import { isActiveStatus, normalizeApiProjects } from '../src/domain/api-normalization.mjs';

assert.strictEqual(isActiveStatus('投放中'), true);
const normalized = normalizeApiProjects({
  totalMetrics: { convert_cnt: '3', show_cnt: '100' },
  projects: [{
    project_id: 'p1',
    project_name: '计划A',
    project_status_name: '投放中',
    metrics: { stat_cost: '10,000', convert_cnt: '2' },
  }],
});
assert.strictEqual(normalized.allProjects[0].spend, 10000);
assert.strictEqual(normalized.activeCnt, 1);

console.log('\n全部测试通过');
