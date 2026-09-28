// 演示数据 - 追加五大区直播 mock (与真实接口 /api/ai-regions-sessions 同构)
const regionsPayload = {
  updated_at: new Date().toISOString(),
  date: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
  nowMin: 14 * 60 + 30,
  regions: [
    { name: '东区', aadvid: '1842681994872135', dayBudget: 7900, budgetRaw: 6373, dayCost: 6400, dayLeads: 62, dayCpl: 103,
      sessions: [
        { roomId: 'm1', status: 'done', start: '06:30', finish: '08:30', startEpoch: 0, finishEpoch: 0, cost: 3200, leads: 38, cpl: 84.2, watch: 52000, budget: 7900, usage: 40.5, carModel: 'S3', sessionNo: 1, unscheduled: false },
        { roomId: 'm2', status: 'done', start: '08:55', finish: '11:01', startEpoch: 0, finishEpoch: 0, cost: 3200, leads: 24, cpl: 133.3, watch: 48000, budget: 4700, usage: 68.1, carModel: 'αS5', sessionNo: 2, unscheduled: false },
        { roomId: 'm3', status: 'live', start: '18:56', finish: '', startEpoch: 68160, finishEpoch: 0, cost: 1500, leads: 12, cpl: 125, watch: 12000, budget: 1500, usage: 100, carModel: 'S3', sessionNo: 3, unscheduled: false }
      ],
      planned: [], updatedAt: '20:00:00' },
    { name: '西区', aadvid: '1842681830951944', dayBudget: 3000, budgetRaw: 3000, dayCost: 2999, dayLeads: 30, dayCpl: 100,
      sessions: [
        { roomId: 'w1', status: 'done', start: '08:55', finish: '11:00', startEpoch: 0, finishEpoch: 0, cost: 2999, leads: 30, cpl: 100, watch: 41000, budget: 3000, usage: 100, carModel: 'S5', sessionNo: 1, unscheduled: false }
      ],
      planned: [], updatedAt: '20:00:00' },
    { name: '南区', aadvid: '1842682454270468', dayBudget: 2800, budgetRaw: 0, dayCost: 2800, dayLeads: 29, dayCpl: 96.6,
      sessions: [
        { roomId: 's0', status: 'done', start: '11:28', finish: '13:28', startEpoch: 0, finishEpoch: 0, cost: 1600, leads: 12, cpl: 133.3, watch: 30000, budget: 0, usage: null, carModel: '', sessionNo: null, unscheduled: true },
        { roomId: 's1', status: 'live', start: '16:29', finish: '', startEpoch: 64140, finishEpoch: 0, cost: 1200, leads: 17, cpl: 70.6, watch: 15000, budget: 1200, usage: 100, carModel: 'S3', sessionNo: 1, unscheduled: false }
      ],
      planned: [{ sessionNo: 2, start: '19:30', end: '21:30', carModel: 'αS5' }], updatedAt: '20:00:00' },
    { name: '北区', aadvid: '1842683071403332', dayBudget: 3000, budgetRaw: 1500, dayCost: 2197, dayLeads: 19, dayCpl: 115.6,
      sessions: [
        { roomId: 'n1', status: 'done', start: '06:23', finish: '08:31', startEpoch: 0, finishEpoch: 0, cost: 1500, leads: 8, cpl: 187.5, watch: 28000, budget: 3000, usage: 50, carModel: 'αT7', sessionNo: 1, unscheduled: false },
        { roomId: 'n2', status: 'live', start: '18:56', finish: '', startEpoch: 68160, finishEpoch: 0, cost: 697, leads: 11, cpl: 63.4, watch: 9000, budget: 1500, usage: 46.5, carModel: 'αS5', sessionNo: 2, unscheduled: false }
      ],
      planned: [], updatedAt: '20:00:00' },
    { name: '中区', aadvid: '1842663909080452', dayBudget: 6600, budgetRaw: 6100, dayCost: 5599, dayLeads: 56, dayCpl: 100,
      sessions: [
        { roomId: 'z1', status: 'done', start: '11:28', finish: '13:28', startEpoch: 0, finishEpoch: 0, cost: 1900, leads: 16, cpl: 118.8, watch: 36000, budget: 6600, usage: 28.8, carModel: 'S3', sessionNo: 1, unscheduled: false },
        { roomId: 'z2', status: 'done', start: '14:00', finish: '16:01', startEpoch: 0, finishEpoch: 0, cost: 2200, leads: 21, cpl: 104.8, watch: 42000, budget: 4700, usage: 46.8, carModel: 'αS5', sessionNo: 2, unscheduled: false },
        { roomId: 'z3', status: 'live', start: '16:27', finish: '', startEpoch: 64020, finishEpoch: 0, cost: 1499, leads: 19, cpl: 78.9, watch: 18000, budget: 2500, usage: 60, carModel: 'αT7', sessionNo: 3, unscheduled: false }
      ],
      planned: [{ sessionNo: 4, start: '20:00', end: '22:00', carModel: 'αT7' }], updatedAt: '20:00:00' }
  ],
  errors: {}
};
module.exports = { regions: regionsPayload };
