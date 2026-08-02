// tests/monitor-scraper.test.mjs - 单页抓取测试
import assert from 'node:assert';
import { scrapeOnePage } from '../src/cdp/monitor-scraper.mjs';

const client = {
  async send() {
    return {
      result: {
        result: {
          value: JSON.stringify({
            campaigns: [{ id: '1', name: '计划A', spend: 100 }],
            accountBudget: 500,
            accountSpend: 100,
            accountBalance: 1000,
            pageSummary: { spend: 100 },
          }),
        },
      },
    };
  },
};

const result = await scrapeOnePage(client);
assert.strictEqual(result.campaigns.length, 1);
assert.strictEqual(result.accountBudget, 500);
assert.strictEqual(result.accountSpend, 100);
assert.strictEqual(result.pageSummary.spend, 100);

console.log('\n全部测试通过');
