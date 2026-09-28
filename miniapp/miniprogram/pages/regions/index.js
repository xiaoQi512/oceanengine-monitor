const store = require('../../utils/store')

function hmToMin(hm) {
  if (!hm) return null
  const m = String(hm).match(/^(\d{1,2}):(\d{2})/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

Page({
  data: {
    loading: true,
    source: '',
    sourceText: '',
    updatedText: '',
    updatedAt: '',
    nowMin: 0,
    lives: [],
    summary: [],
    regions: [],
    errors: {}
  },

  onLoad() { this.refresh() },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 })
    }
  },
  onPullDownRefresh() { this.refresh().then(() => wx.stopPullDownRefresh()) },

  async refresh() {
    this.setData({ loading: true })
    try {
      const { source, data } = await store.getRegions()
      const regions = data.regions || []
      const nowMin = data.nowMin || 0
      // 在播直播间(最多 2 个, 按消耗排序) — 对齐仪表盘在播展示窗
      const lives = []
      for (const rg of regions) {
        for (const s of (rg.sessions || [])) {
          if (s.status !== 'live') continue
          const startMin = hmToMin(s.start)
          const dur = startMin != null && nowMin ? Math.max(0, nowMin - startMin) : null
          lives.push({
            region: rg.name,
            carModel: s.carModel || '—',
            start: s.start,
            durText: dur != null ? (Math.floor(dur / 60) ? Math.floor(dur / 60) + 'h' : '') + (dur % 60) + 'm' : '—',
            cost: Math.round(s.cost || 0).toLocaleString(),
            leads: s.leads || 0,
            cpl: s.cpl > 0 ? (Math.round(s.cpl * 10) / 10).toLocaleString() : '—',
            budget: s.budget > 0 ? Math.round(s.budget).toLocaleString() : '—',
            usage: s.usage == null ? '—' : (s.usage > 999 ? '>999' : s.usage),
            usageCls: s.usage == null ? '' : s.usage >= 100 ? 'hot' : s.usage >= 80 ? 'warm' : 'good'
          })
        }
      }
      lives.sort((a, b) => (b.cost || 0) - (a.cost || 0))
      // 汇总
      const totC = regions.reduce((a, r) => a + (r.dayCost || 0), 0)
      const totL = regions.reduce((a, r) => a + (r.dayLeads || 0), 0)
      const liveCnt = regions.filter(r => (r.sessions || []).some(s => s.status === 'live')).length
      const summary = [
        { k: '今日总消耗', v: '¥' + Math.round(totC).toLocaleString() },
        { k: '今日总线索', v: Math.round(totL) + ' 条' },
        { k: '平均线索成本', v: totL > 0 ? '¥' + Math.round(totC / totL) : '—' },
        { k: '在播区数', v: liveCnt + ' / ' + regions.length }
      ]
      // 区模块: 已播时长等派生字段
      const view = regions.map(rg => ({
        name: rg.name,
        dayBudget: Math.round(rg.dayBudget || 0).toLocaleString(),
        dayCost: Math.round(rg.dayCost || 0).toLocaleString(),
        dayLeads: rg.dayLeads || 0,
        dayCpl: rg.dayCpl > 0 ? '¥' + rg.dayCpl : '—',
        cnt: (rg.sessions || []).length + '+' + (rg.planned || []).length,
        badge: (rg.sessions || []).some(s => s.status === 'live') ? { txt: '🔴 在播', cls: 'live' }
          : (rg.planned || []).length ? { txt: '待开播', cls: 'planned' }
          : (rg.sessions || []).length ? { txt: '已收播', cls: 'done' } : { txt: '无场次', cls: 'done' },
        sessions: (rg.sessions || []).map(s => ({
          ...s,
          carTxt: s.carModel || (s.unscheduled ? '⚠ 计划外' : '—'),
          costTxt: Math.round(s.cost || 0).toLocaleString(),
          cplTxt: s.cpl > 0 ? '¥' + s.cpl : '—',
          usageTxt: s.usage == null ? '—' : (s.usage > 999 ? '>999' : s.usage) + '%',
          usageCls: s.usage == null ? '' : s.usage >= 100 ? 'hot' : s.usage >= 80 ? 'warm' : 'good',
          finishTxt: s.status === 'live' ? '直播中' : (s.finish || '')
        })),
        planned: (rg.planned || []).map(p => ({ ...p })),
        error: (data.errors || {})[rg.name] || ''
      }))
      const updatedAt = data.updatedAt || data.date || ''
      this.setData({
        loading: false,
        source,
        sourceText: source === 'cloud' ? '实时数据' : source === 'db' ? '云端缓存' : '演示数据',
        updatedText: updatedAt,
        updatedAt,
        nowMin,
        lives: lives.slice(0, 2),
        livesOverflow: lives.length > 2,
        summary,
        regions: view
      })
    } catch (e) {
      this.setData({ loading: false, sourceText: '加载失败: ' + e.message })
    }
  }
})
