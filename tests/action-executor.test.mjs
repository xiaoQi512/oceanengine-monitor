// tests/action-executor.test.mjs - action 执行器测试
import assert from 'node:assert';
import { reportToFeishu, executeAction, tryHttpApi, isChromeHealthy, readPlanAfterValue } from '../src/services/action-executor.mjs';

let pushed = null;
await reportToFeishu({ type: 'pause', source: 'feishu' }, { ok: true }, '计划A', {
  findLarkCliFn: () => 'lark',
  pushTextFn: async (cli, text) => { pushed = { cli, text }; },
});
assert.strictEqual(pushed.cli, 'lark');
assert.ok(pushed.text.includes('计划A'));

let toggled = null;
const exec = await executeAction({ type: 'pause', planName: '计划A' }, {
  getCdpActionFn: async () => ({
    togglePlanStatus: async (planName, status) => {
      toggled = { planName, status };
      return { ok: true };
    },
  }),
});
assert.strictEqual(exec.ok, true);
assert.strictEqual(toggled.status, 'pause');

let httpCall = null;
const http = await tryHttpApi({ type: 'pause', planName: '计划A' }, 'p1', {
  getApiClientFn: async () => ({
    createClient: async () => ({}),
    updateProjectStatus: async (client, args) => {
      httpCall = args;
      return { ok: true };
    },
    updateProjectBudget: async () => ({}),
    updateProjectBid: async () => ({}),
  }),
});
assert.strictEqual(http.ok, true);
assert.strictEqual(httpCall.projectId, 'p1');

assert.strictEqual(await isChromeHealthy({ checkCDPFn: async () => ({ reachable: true }) }), true);
assert.strictEqual(await isChromeHealthy({ checkCDPFn: async () => ({ reachable: false }) }), false);

const before = await readPlanAfterValue('计划A', 100, {
  getApiClientFn: async () => ({
    createClient: async () => ({
      request: async () => ({
        data: { data: { projects: [{ project_name: '计划A', project_id: 'p1', project_status_name: '启用', campaign_budget: 100 }] } },
      }),
    }),
  }),
});
assert.strictEqual(before.projectId, 'p1');

console.log('\n全部测试通过');
