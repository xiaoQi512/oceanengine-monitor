// tests/card-sections.test.mjs - 卡片区块测试
import assert from 'node:assert';
import { buildPacingLines, buildMetricsLines } from '../src/domain/card-sections.mjs';

const pacing = buildPacingLines({ timeProgress: 0.5, budgetUsed: 0.2, pacingHealth: 'good', projectedDaily: 100, windowDuration: 16, elapsedHours: 8, dailyBudget: 1000, timeSlot: '午高峰' }, { totalSpend: 100 });
assert.ok(pacing.some(l => l.includes('消耗节奏正常')));
const metrics = buildMetricsLines({ age15: 15, speedHour: 1, speedCurrent: 1, convLast15min: 2, cplLast15min: 10, spendLast15min: 10 }, { totalSpend: 100, avgCPA: 10, totalConversions: 1, totalLeads: 1, totalPrivateMsgOpen: 1, openRetainRate: 1, avgCPM: 10, totalSpending: 1, totalActive: 1 }, [], []);
assert.ok(metrics.some(l => l.includes('**转化**')));

console.log('\n全部测试通过');
