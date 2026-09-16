const store = require('../../utils/store')

Page({
  data: {
    sourceText: '演示数据',
    logs: []
  },

  onLoad() {
    // 首次加载由 onShow 统一触发刷新
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
    const now = Date.now()
    if (!this._lastPull || now - this._lastPull > 120000) {
      this._lastPull = now
      this.refresh()
    }
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    this._lastPull = Date.now()
    try {
      const { source, data } = await store.getDashboard()
      this.setData({
        sourceText: source === 'mock' ? '演示数据' : '云端实时',
        logs: data.action_logs || []
      })
    } catch (e) {
      console.error('执行记录加载失败', e)
      wx.showToast({ title: '数据加载失败', icon: 'none' })
    }
  }
})
