// 自定义 tabBar - 纯 CSS 图标, 不依赖图片文件(绕开中文路径资源解析 bug)
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/overview/index', text: '总览', type: 'ov' },
      { pagePath: '/pages/campaigns/index', text: '计划', type: 'cp' },
      { pagePath: '/pages/details/index', text: '明细', type: 'dt' },
      { pagePath: '/pages/alerts/index', text: '记录', type: 'al' }
    ]
  },
  methods: {
    switchTab(e) {
      const { path, index } = e.currentTarget.dataset
      wx.switchTab({ url: path })
      this.setData({ selected: index })
    }
  }
})
