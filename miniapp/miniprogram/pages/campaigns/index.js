const store = require('../../utils/store')
const fmt = require('../../utils/format')

Page({
  data: {
    sourceText: '演示数据',
    searchKey: '',
    filter: 'spending',   // 默认: 本场有消耗
    sortKey: 'cost',
    campaigns: [],
    shownCampaigns: [],   // 分页渲染 (默认30条, 加载更多)
    pageSize: 30,
    activeCount: 0,
    // 详情弹层
    detailOpen: false,
    detailCampaign: {},
    detailBars: [],
    // 预算弹层
    budgetOpen: false,
    budgetCampaign: {},
    budgetValue: 0,
    budgetBusy: false
  },

  allCampaigns: [],

  onLoad() {
    // 首次加载由 onShow 统一触发刷新
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
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
      const { source, data } = await store.getCampaigns()
      this.allCampaigns = (data || []).map(c => ({
        ...c,
        fmtCost: fmt.fmtMoney(c.cost),
        fmtCpa: fmt.fmtMoney(c.cpa),
        budgetPct: c.budget ? Math.round(c.cost / c.budget * 100) : 0   // 整数, 不留小数
      }))
      this.setData({
        sourceText: source === 'mock' ? '演示数据' : '云端实时',
        activeCount: this.allCampaigns.filter(c => c.status === '投放中').length
      })
      this.applyFilter()
    } catch (e) {
      console.error('campaigns 加载失败', e)
      wx.showToast({ title: '数据加载失败', icon: 'none' })
    }
  },

  applyFilter() {
    const f = this.data.filter
    const key = String(this.data.searchKey || '').trim().toLowerCase()
    let list = this.allCampaigns
    // 搜索: 名称/形式模糊
    if (key) {
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(key) || (c.type || '').toLowerCase().includes(key)
      )
    }
    // 分类: 默认本场有消耗; 未启动=当日零消耗(含启用未花与已暂停)
    if (f === 'spending') {
      list = list.filter(c => c.cost > 0)
    } else if (f === 'zero') {
      list = list.filter(c => !(c.cost > 0))
    } else if (f === '投放中' || f === '已暂停') {
      list = list.filter(c => c.status === f)
    }
    // 排序
    const sk = this.data.sortKey
    list = list.slice().sort((a, b) => {
      if (sk === 'cpa') return (b.cpa || 1e9) - (a.cpa || 1e9) || b.cost - a.cost
      return (b.cost || 0) - (a.cost || 0)
    })
    this.setData({
      campaigns: list,
      shownCampaigns: list.slice(0, this.data.pageSize)
    })
  },

  loadMore() {
    const size = this.data.shownCampaigns.length + this.data.pageSize
    this.setData({ shownCampaigns: this.data.campaigns.slice(0, size) })
  },

  onSearch(e) {
    this.setData({ searchKey: e.detail.value })
    this.applyFilter()
  },

  setFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.f })
    this.applyFilter()
  },

  setSort(e) {
    this.setData({ sortKey: e.currentTarget.dataset.k })
    this.applyFilter()
  },

  // 计划详情弹层
  openDetail(e) {
    const camp = this.allCampaigns.find(c => c.id === e.currentTarget.dataset.id) || {}
    const week = camp.week || []
    const wMax = Math.max(...week.map(w => w.cost), 1)
    // CPA 折线: 有线索的日才有 CPA, 相对最大 CPA 定位
    const cpaVals = week.filter(w => w.leads > 0).map(w => w.cost / w.leads)
    const cpaMax = Math.max(...cpaVals, 1)
    this.setData({
      detailOpen: true,
      detailCampaign: camp,
      detailBars: week.map((w, i) => {
        const cpa = w.leads > 0 ? Math.round(w.cost / w.leads) : null
        return {
          d: w.d, cost: w.cost, cpa,
          pct: Math.round(w.cost / wMax * 150) + 6,
          cpaPct: cpa === null ? null : Math.max(4, Math.round(cpa / cpaMax * 150)),
          hot: i === week.length - 1
        }
      })
    })
  },

  closeDetail() {
    this.setData({ detailOpen: false })
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
          this.setData({ detailOpen: false })
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
        this.setData({ budgetOpen: false, budgetBusy: false, detailOpen: false })
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
