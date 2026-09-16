// 数据读取层: 云托管 callContainer 优先 → 云数据库直读兜底 → 演示数据
const config = require('../config')
const mock = require('./mock')

function callCloud(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: { env: config.CLOUD_ENV },
      path,
      method,
      data,
      timeout: 12000,
      // 多服务环境必须显式指定目标服务, 否则网关报 INVALID_PATH
      header: { 'X-WX-SERVICE': config.CALL_CONTAINER_SERVICE }
    }).then(res => {
      if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
      else reject(new Error('HTTP ' + res.statusCode))
    }).catch(reject)
  })
}

// 仪表盘聚合数据(总览页/告警页共用)
async function getDashboard() {
  try {
    const data = await callCloud('/dashboard')
    if (data && data.summary) return { source: 'cloud', data }
    throw new Error('empty')
  } catch (e1) {
    try {
      const db = wx.cloud.database()
      const res = await db.collection('latest_summary')
        .orderBy('updated_at', 'desc').limit(1).get()
      if (res.data && res.data.length) return { source: 'db', data: res.data[0].payload }
      throw new Error('empty')
    } catch (e2) {
      if (config.USE_MOCK_FALLBACK) return { source: 'mock', data: mock.dashboard }
      throw e2
    }
  }
}

// 计划列表
async function getCampaigns() {
  try {
    const data = await callCloud('/campaigns')
    if (data && data.campaigns) return { source: 'cloud', data: data.campaigns }
    throw new Error('empty')
  } catch (e1) {
    try {
      const db = wx.cloud.database()
      const res = await db.collection('campaigns').limit(50).get()
      if (res.data && res.data.length) return { source: 'db', data: res.data }
      throw new Error('empty')
    } catch (e2) {
      if (config.USE_MOCK_FALLBACK) return { source: 'mock', data: mock.campaigns }
      throw e2
    }
  }
}

// 告警列表
async function getAlerts() {
  try {
    const data = await callCloud('/alerts')
    if (data && data.alerts) return { source: 'cloud', data: data.alerts }
    throw new Error('empty')
  } catch (e1) {
    try {
      const db = wx.cloud.database()
      const res = await db.collection('alerts').orderBy('time', 'desc').limit(50).get()
      if (res.data && res.data.length) return { source: 'db', data: res.data }
      throw new Error('empty')
    } catch (e2) {
      if (config.USE_MOCK_FALLBACK) return { source: 'mock', data: mock.alerts }
      throw e2
    }
  }
}

// 提交操作指令: 走云托管入队 → 家里 poller 消费 → action-queue 执行
async function submitCommand(command) {
  return callCloud('/command', 'POST', command)
}

module.exports = { getDashboard, getCampaigns, getAlerts, submitCommand, callCloud }
