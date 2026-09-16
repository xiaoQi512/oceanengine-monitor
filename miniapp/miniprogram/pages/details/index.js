const store = require('../../utils/store')
const fmt = require('../../utils/format')

Page({
  data: {
    sourceText: '演示数据',
    updatedText: '--:--',
    s: {},
    funnel: [],
    shifts: [],
    formats: [],
    webcast: []
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    try {
      const { source, data } = await store.getDashboard()
      const s = data.summary || {}
      // 转化漏斗: 曝光 → 点击 → 观看 → 停留(>1min) → 开口 → 留资 → 线索
      const layers = [
        { label: '曝光', raw: s.impressions },
        { label: '点击', raw: s.clicks },
        { label: '观看人次', raw: s.live_views },
        { label: '停留超1分钟', raw: s.live_1min },
        { label: '私信开口', raw: s.opens },
        { label: '私信留资', raw: s.retains },
        { label: '线索', raw: s.leads }
      ]
      const maxRaw = Math.max(...layers.map(l => Number(l.raw) || 0), 1)
      const prev = []
      const funnel = layers.map(l => {
        const rate = prev.length && Number(prev[prev.length - 1].raw) > 0 && Number(l.raw) >= 0
          ? ((Number(l.raw) / Number(prev[prev.length - 1].raw)) * 100).toFixed(1) + '%' : ''
        prev.push(l)
        return {
          label: l.label,
          value: fmt.fmtNum(l.raw),
          pct: Math.max(4, Math.round((Number(l.raw) || 0) / maxRaw * 100)),
          rate
        }
      })
      this.setData({
        sourceText: source === 'mock' ? '演示数据' : '云端实时',
        updatedText: fmt.fmtTime(data.updated_at),
        s,
        funnel,
        shifts: data.shifts || [],
        formats: data.formats || [],
        webcast: (data.webcast_rooms || []).slice(0, 7)
      })
    } catch (e) {
      console.error('明细加载失败', e)
      wx.showToast({ title: '数据加载失败', icon: 'none' })
    }
  }
})
