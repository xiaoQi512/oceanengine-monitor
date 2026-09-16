const store = require('../../utils/store')
const fmt = require('../../utils/format')

Page({
  data: {
    source: 'mock',
    sourceText: '演示数据',
    updatedText: '--:--',
    liveStatus: '直播状态获取中',
    liveWindowText: '今日排班',
    summary: {},
    pacing: { health: 'good', health_text: '--', projected_daily: 0 },
    fmtCost: '¥--',
    fmtYesterday: '¥--',
    fmtCpa: '--',
    costVsYesterday: '',
    cpaDelta: { text: '', cls: 'neutral' },
    last15: { minutes: 15, spend: 0, leads: 0, opens: 0, top5: [] },
    hourlyBars: [],
    weeklyBars: [],
    weeklyAvg: 0,
    shifts: [],
    formats: [],
    alerts: [],
    loading: true
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    try {
      const { source, data } = await store.getDashboard()
      const s = data.summary || {}

      // 1小时趋势柱
      const ht = data.hourly_trend || []
      const htMax = Math.max(...ht.map(x => x.cost), 1)
      const hourlyBars = ht.map((x, i) => ({
        t: x.t, cost: x.cost,
        pct: Math.round(x.cost / htMax * 150) + 6,
        hot: i === ht.length - 1,
        showLabel: i % 3 === 0 || i === ht.length - 1
      }))

      // 近7日柱
      const wk = data.weekly || []
      const wkMax = Math.max(...wk.map(x => x.cost), 1)
      const weeklyBars = wk.map((x, i) => ({
        date: x.date, cost: x.cost,
        pct: Math.round(x.cost / wkMax * 150) + 6,
        hot: i === wk.length - 1
      }))
      const wkAvg = wk.length ? Math.round(wk.reduce((a, b) => a + b.cost, 0) / wk.length) : 0

      // 高于/低于昨日
      const costVs = s.cost > (s.yesterday_cost || 0) ? '高于昨日' : '低于昨日'

      this.setData({
        source,
        sourceText: source === 'cloud' ? '云端实时' : source === 'db' ? '云端数据库' : '演示数据',
        updatedText: fmt.fmtTime(data.updated_at),
        liveStatus: data.live_status || '直播状态未知',
        liveWindowText: data.live_window ? `${data.live_window.start}-${data.live_window.end}` : '今日排班',
        summary: s,
        pacing: data.pacing || {},
        fmtCost: fmt.fmtMoney(s.cost),
        fmtYesterday: fmt.fmtMoney(s.yesterday_cost),
        fmtCpa: fmt.fmtMoney(s.cpa),
        costVsYesterday: s.yesterday_cost ? costVs : '',
        cpaDelta: fmt.fmtDelta(s.cpa_delta_pct),
        last15: data.last15 || { minutes: 15, spend: 0, leads: 0, opens: 0, top5: [] },
        hourlyBars,
        weeklyBars,
        weeklyAvg: wkAvg,
        alerts: (data.alerts || []).slice(0, 5),
        loading: false
      })
      getApp().globalData.dashboardCache = data
    } catch (e) {
      console.error('dashboard 加载失败', e)
      wx.showToast({ title: '数据加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  }
})
