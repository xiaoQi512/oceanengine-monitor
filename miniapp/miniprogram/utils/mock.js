// 演示数据 - 对齐 20260916 总览重构版结构, 云端无数据时兜底展示
module.exports = {
  dashboard: {
    updated_at: new Date().toISOString(),
    live_status: '直播中 · 阿尔法S5',
    live_window: { start: '05:30', end: '23:30', duration: 18 },
    summary: {
      cost: 14862,
      yesterday_cost: 13206,
      yesterday_leads: 121,
      budget: 20000,
      cost_progress: 74,
      leads: 97,
      retain_rate: 68.4,
      cpl: 153.2,
      open_cost: 36.9,
      cpm: 143.5,
      ctr: 5.8,
      opens: 402,
      retains: 275,
      forms: 61,
      cpa: 153.2,
      cpa_delta_pct: 5.9,
      speed_15m: 48.6,
      avg_speed: 55.4,
      time_progress: 81,
      impressions: 103600,
      clicks: 6890,
      live_views: 152800,
      live_1min: 41200,
      comments: 3580,
      balance: 220918,
      spending_count: 5,
      spending_today: 12
    },
    pacing: {
      time_progress: 81,
      budget_used: 74,
      health: 'good',
      health_text: '节奏健康',
      projected_daily: 18348
    },
    last15: {
      minutes: 15,
      spend: 729,
      leads: 4,
      opens: 23,
      retains: 15,
      forms: 3,
      speed_1h: 44.2,
      top5: [
        { name: '极狐-东区-阿尔法S5-直播04', cost: 312, leads: 0, cpl: null, warn: true },
        { name: '极狐-南区-问道V9-直播01', cost: 205, leads: 2, cpl: 103, warn: false },
        { name: '极狐-北区-S5-直播03', cost: 118, leads: 1, cpl: 118, warn: false }
      ]
    },
    hourly_trend: ['18:40','18:45','18:50','18:55','19:00','19:05','19:10','19:15','19:20','19:25','19:30','19:35']
      .map((t, i) => ({ t, cost: 180 + Math.round(Math.sin(i) * 120) + 140 })),
    weekly: [
      { date: '09/10', cost: 32945, leads: 301 },
      { date: '09/11', cost: 29873, leads: 274 },
      { date: '09/12', cost: 42769, leads: 391 },
      { date: '09/13', cost: 51286, leads: 455 },
      { date: '09/14', cost: 33254, leads: 310 },
      { date: '09/15', cost: 59103, leads: 543 },
      { date: '09/16', cost: 14862, leads: 97 }
    ],
    shifts: [
      { label: '05:30-07:30', anchor: '三水', spend: 2574, leads: 24, cpl: 107.3 },
      { label: '07:30-09:30', anchor: '小烁', spend: 4272, leads: 39, cpl: 109.5 },
      { label: '09:30-11:30', anchor: '三水', spend: 3894, leads: 33, cpl: 118.0 }
    ],
    formats: [
      { name: '画面直投', count: 67, cost: 9525, leads: 82, cpl: 116.2 },
      { name: '短视频引流', count: 29, cost: 2148, leads: 19, cpl: 113.1 },
      { name: '简单投', count: 4, cost: 1189, leads: 9, cpl: 132.1 }
    ],
    action_logs: [
      { time: '12:03', type: '启用计划', name: '0826-真人直播-简单投-画面直投', detail: '状态 暂停 → 启用', status: 'success' },
      { time: '11:47', type: '调整预算', name: '0913-真人直播-画面直投', detail: '预算 ¥8000.00 → ¥10000.00', status: 'success' },
      { time: '10:22', type: '暂停计划', name: '0909-真人直播-画面直投', detail: '状态 启用 → 暂停', status: 'success' }
    ],
    campaigns: [
      { id: 'c1', name: '极狐-东区-阿尔法S5-直播04', status: '投放中', cost: 4820, budget: 10000, leads: 22, cpa: 216.8, cpa_delta_pct: 38.2, ctr: 6.2, cpm: 152.4 },
      { id: 'c2', name: '极狐-南区-问道V9-直播01', status: '投放中', cost: 5310, budget: 11000, leads: 38, cpa: 139.7, cpa_delta_pct: -4.2, ctr: 5.1, cpm: 128.7 },
      { id: 'c3', name: '极狐-北区-S5-直播03', status: '已暂停', cost: 2160, budget: 8000, leads: 9, cpa: 240.0, cpa_delta_pct: 12.0, ctr: 4.4, cpm: 161.2 }
    ],
    alerts: [
      { id: 'a1', severity: 'high', type: 'cpa_rise', campaign: '极狐-东区-阿尔法S5-直播04', time: '19:52', message: 'CPA 环比上涨 38.2%, 当前 ¥216.8' },
      { id: 'a2', severity: 'medium', type: 'speed', campaign: '极狐-南区-问道V9-直播01', time: '19:40', message: '15分钟消耗速度为1小时均速的 172%' }
    ]
  }
}
