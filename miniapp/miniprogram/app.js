const config = require('./config')

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('基础库版本过低, 无法使用云能力')
      return
    }
    try {
      wx.cloud.init({
        env: config.CLOUD_ENV,
        traceUser: false
      })
      this.globalData.cloudReady = true
    } catch (e) {
      console.error('云开发初始化失败', e)
      this.globalData.cloudReady = false
    }
  },
  globalData: {
    cloudReady: false,
    // 最近一次仪表盘数据缓存(离线兜底)
    dashboardCache: null
  }
})
