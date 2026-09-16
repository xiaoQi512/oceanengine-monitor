const store = require('../../utils/store')

Page({
  data: {
    sourceText: '演示数据',
    logs: []
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
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
