const store = require('../../utils/store')
const fmt = require('../../utils/format')

Page({
  data: {
    sourceText: '演示数据',
    filter: 'all',
    campaigns: [],
    shownCampaigns: [],   // 分页渲染 (默认30条, 加载更多)
    pageSize: 30,
    fmtCosts: {},
    fmtCpas: {},
    // 预算弹层
    budgetOpen: false,
    budgetCampaign: {},
    budgetValue: 0,
    budgetBusy: false
  },

  allCampaigns: [],

  onLoad() {
    this.refresh()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    try {
      const { source, data } = await store.getCampaigns()
      this.allCampaigns = data || []
      const fmtCosts = {}, fmtCpas = {}
      this.allCampaigns.forEach(c => {
        fmtCosts[c.id] = fmt.fmtMoney(c.cost)
        fmtCpas[c.id] = fmt.fmtMoney(c.cpa)
      })
      this.setData({
        sourceText: source === 'mock' ? '演示数据' : '云端实时',
        fmtCosts, fmtCpas
      })
      this.applyFilter()
    } catch (e) {
      console.error('campaigns 加载失败', e)
      wx.showToast({ title: '数据加载失败', icon: 'none' })
    }
  },

  applyFilter() {
    const f = this.data.filter
    let list = this.allCampaigns
    if (f === '投放中' || f === '已暂停') {
      list = list.filter(c => c.status === f)
    } else if (f === 'warn') {
      list = list.filter(c => c.cpa_delta_pct > 20)
    }
    this.setData({
      campaigns: list,
      shownCampaigns: list.slice(0, this.data.pageSize)
    })
  },

  loadMore() {
    const size = this.data.shownCampaigns.length + this.data.pageSize
    this.setData({ shownCampaigns: this.data.campaigns.slice(0, size) })
  },

  setFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.f })
    this.applyFilter()
  },

  // 暂停/启用
  onToggle(e) {
    const id = e.currentTarget.dataset.id
    const status = e.currentTarget.dataset.status
    const action = status === '投放中' ? 'pause' : 'enable'
    const actionText = action === 'pause' ? '暂停' : '启用'
    const camp = this.allCampaigns.find(c => c.id === id) || {}
    wx.showModal({
      title: `确认${actionText}计划`,
      content: `${camp.name}\n${action === 'pause' ? '暂停后该计划将停止消耗' : '启用后计划恢复投放'}`,
      confirmText: `确认${actionText}`,
      confirmColor: action === 'pause' ? '#FF5A5A' : '#2EDB8B',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await store.submitCommand({
            action, campaign_id: camp.id, campaign_name: camp.name
          })
          wx.showToast({ title: '指令已提交', icon: 'success' })
        } catch (err) {
          wx.showToast({ title: '提交失败, 稍后重试', icon: 'none' })
        }
      }
    })
  },

  // 调整预算弹层
  openBudget(e) {
    const camp = this.allCampaigns.find(c => c.id === e.currentTarget.dataset.id) || {}
    this.setData({
      budgetOpen: true,
      budgetCampaign: camp,
      budgetValue: camp.budget || 0
    })
  },

  closeBudget() {
    if (this.data.budgetBusy) return
    this.setData({ budgetOpen: false })
  },

  quickAdd(e) {
    const v = Number(e.currentTarget.dataset.v) || 0
    this.setData({ budgetValue: Number(this.data.budgetValue || 0) + v })
  },

  onBudgetInput(e) {
    this.setData({ budgetValue: e.detail.value })
  },

  async confirmBudget() {
    const camp = this.data.budgetCampaign
    const val = Number(this.data.budgetValue)
    if (!val || val < 50) {
      wx.showToast({ title: '预算不能低于¥50', icon: 'none' })
      return
    }
    if (val === camp.budget) {
      wx.showToast({ title: '预算未变化', icon: 'none' })
      return
    }
    const deltaPct = Math.abs(val - camp.budget) / camp.budget * 100
    const doSubmit = () => {
      this.setData({ budgetBusy: true })
      store.submitCommand({
        action: 'update_budget',
        campaign_id: camp.id,
        campaign_name: camp.name,
        params: { budget: val, old_budget: camp.budget, delta_pct: Math.round(deltaPct) }
      }).then(() => {
        wx.showToast({ title: '指令已提交', icon: 'success' })
        this.setData({ budgetOpen: false, budgetBusy: false })
      }).catch(() => {
        wx.showToast({ title: '提交失败, 稍后重试', icon: 'none' })
        this.setData({ budgetBusy: false })
      })
    }
    // 高风险: 预算变动超 20% 二次确认
    if (deltaPct > 20) {
      wx.showModal({
        title: '高风险操作确认',
        content: `预算变动 ${Math.round(deltaPct)}% (¥${camp.budget} → ¥${val}), 确认执行?`,
        confirmColor: '#FF5A5A',
        success: (r) => { if (r.confirm) doSubmit() }
      })
    } else {
      doSubmit()
    }
  }
})
