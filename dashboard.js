// dashboard.js — Alpine.js 组件 + ECharts 桥接
// 巨量引擎监控 Dashboard 主逻辑

const UP_COLOR = '#ef4444';   // 中国股市惯例：涨=红
const DOWN_COLOR = '#22c55e'; // 跌=绿

function dashboardApp() {
  return {
    // ====== 多账户/平台状态 ======
    accounts: [],           // 账户列表 [{id, name, platform, spend, leads, cpa, activeCount}]
    accountsOverview: [],   // 多账户KPI总览（同 accounts 或派生）
    currentAccount: '',     // 当前选中账户 id
    currentPlatform: 'oceanengine',  // oceanengine | tencent | kuaishou
    overviewCollapsed: false,  // 顶部总览区折叠态

    // ====== 排序状态 ======
    sortKey: 'spend',       // spend | cpa | leads | budget | name
    sortDir: 'desc',        // asc | desc

    // ====== 筛选状态 ======
    filterStatus: 'all',    // all | active | paused
    filterSearch: '',
    filterCpaMin: null,
    filterCpaMax: null,

    // ====== 主状态 ======
    campaigns: [],
    summary: {},
    alerts: [],          // 原始告警（当日）
    alertsRaw: [],       // API 原始告警（未过滤）
    loading: false,
    lastUpdate: '',
    error: '',

    // 弹窗/Toast 状态（Step2 扩展）
    toast: { show: false, msg: '', type: 'info' },
    modal: { show: false, type: '', title: '', campaignId: '', campaignName: '', value: 0, oldValue: 0 },

    // ECharts 实例
    _charts: { trend: null, dist: null },
    _pollTimer: null,

    // ====== 初始化 ======
    init() {
      this.loadData();
      this._pollTimer = setInterval(() => this.loadData(), 15000);

      // ECharts 桥接：summary 变化时重渲染
      this.$watch('summary', (val) => {
        if (val && Object.keys(val).length > 0) this.renderCharts(val);
      });

      // 响应式重绘
      window.addEventListener('resize', () => this._resizeCharts());
    },

    destroy() {
      if (this._pollTimer) clearInterval(this._pollTimer);
      Object.values(this._charts).forEach(c => c?.dispose());
    },

    // ====== 数据加载 ======
    async loadData() {
      this.loading = true;
      this.error = '';
      try {
        const [snapRes, campRes, alertRes, accRes] = await Promise.allSettled([
          fetch('/api/snapshots', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
          fetch('/api/campaigns', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
          fetch('/api/alerts', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
          fetch('/api/accounts', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
        ]);

        if (snapRes.status === 'fulfilled' && snapRes.value) {
          this.summary = this._buildSummary(snapRes.value);
        }
        if (campRes.status === 'fulfilled' && campRes.value) {
          const list = Array.isArray(campRes.value) ? campRes.value
            : (campRes.value.projects || campRes.value.campaigns || []);
          this.campaigns = list;
        }
        if (alertRes.status === 'fulfilled' && alertRes.value) {
          const rawList = Array.isArray(alertRes.value) ? alertRes.value : (alertRes.value.alerts || []);
          this.alertsRaw = rawList;
          // 仅保留当日告警
          const todayStr = new Date().toISOString().slice(0, 10);
          this.alerts = rawList.filter(a => {
            const t = a.time || a.createdAt || '';
            return String(t).slice(0, 10) === todayStr;
          });
        }

        // 多账户加载（失败降级为单账户模式）
        if (accRes.status === 'fulfilled' && accRes.value) {
          const accList = Array.isArray(accRes.value) ? accRes.value : (accRes.value.accounts || []);
          this.accounts = accList;
          this.accountsOverview = accList;
          // 默认选第一个账户
          if (!this.currentAccount && accList.length > 0) {
            this.currentAccount = accList[0].id;
          }
        } else {
          this.accounts = [];
          this.accountsOverview = [];
        }

        this.lastUpdate = new Date().toLocaleTimeString('zh-CN');
      } catch (e) {
        this.error = e.message || '加载失败';
      } finally {
        this.loading = false;
      }
    },

    // ====== 从快照构造汇总 ======
    _buildSummary(snap) {
      // 多账户聚合：优先使用 snap.accounts
      if (snap && snap.accounts && Array.isArray(snap.accounts) && snap.accounts.length > 0) {
        const accList = snap.accounts;
        const totalSpend = accList.reduce((s, a) => s + (Number(a.spend) || 0), 0);
        const totalLeads = accList.reduce((s, a) => s + (Number(a.leads) || 0), 0);
        const activeCount = accList.reduce((s, a) => s + (Number(a.activeCount) || 0), 0);
        const avgCpa = totalLeads > 0 ? totalSpend / totalLeads : 0;
        const totalBudget = accList.reduce((s, a) => s + (Number(a.budget) || 0), 0);

        const trend = snap.hourly || snap.trend || null;
        const dist = accList.slice(0, 10).map(a => ({
          name: a.name || a.id,
          value: Number(a.spend) || 0,
          cpa: Number(a.cpa) || 0,
        })).sort((a, b) => b.value - a.value);

        return {
          totalSpend, totalLeads, avgCpa, totalBudget,
          activeCount, pausedCount: accList.length - activeCount,
          campaignCount: accList.length,
          trend, dist,
          raw: snap,
        };
      }

      // 单账户原逻辑
      const list = Array.isArray(snap) ? snap
        : (snap.allSpending || snap.active || snap.projects || []);
      const totalSpend = list.reduce((s, c) => s + (Number(c.spend) || 0), 0);
      const totalLeads = list.reduce((s, c) => s + (Number(c.leads) || Number(c.conversions) || 0), 0);
      const activeCount = list.filter(c => (c.rawStatus || c.status || '').includes('启用')).length;
      const avgCpa = totalLeads > 0 ? totalSpend / totalLeads : 0;
      const totalBudget = list.reduce((s, c) => s + (Number(c.budget) || 0), 0);

      // 构造小时级趋势（按 id 分组取 spend；如快照含 hourly 则优先用）
      const trend = snap.hourly || snap.trend || null;
      const dist = list.slice(0, 10).map(c => ({
        name: c.name || c.id,
        value: Number(c.spend) || 0,
        cpa: Number(c.cpa) || 0,
      })).sort((a, b) => b.value - a.value);

      return {
        totalSpend, totalLeads, avgCpa, totalBudget,
        activeCount, pausedCount: list.length - activeCount,
        campaignCount: list.length,
        trend, dist,
        raw: snap,
      };
    },

    // ====== 排序/筛选 computed ======
    get filteredCampaigns() {
      let list = this.campaigns.slice();

      // 状态筛选
      if (this.filterStatus === 'active') {
        list = list.filter(c => (c.rawStatus || c.status || '').includes('启用'));
      } else if (this.filterStatus === 'paused') {
        list = list.filter(c => !(c.rawStatus || c.status || '').includes('启用'));
      }

      // 名称模糊搜索
      if (this.filterSearch && this.filterSearch.trim()) {
        const kw = this.filterSearch.trim().toLowerCase();
        list = list.filter(c => String(c.name || c.id || '').toLowerCase().includes(kw));
      }

      // CPA 区间筛选
      const minV = this.filterCpaMin !== null && this.filterCpaMin !== '' ? Number(this.filterCpaMin) : null;
      const maxV = this.filterCpaMax !== null && this.filterCpaMax !== '' ? Number(this.filterCpaMax) : null;
      list = list.filter(c => {
        const cpa = Number(c.cpa) || 0;
        if (minV !== null && cpa < minV) return false;
        if (maxV !== null && cpa > maxV) return false;
        return true;
      });

      // 排序
      const key = this.sortKey;
      const dir = this.sortDir === 'asc' ? 1 : -1;
      list.sort((a, b) => {
        let av, bv;
        if (key === 'name') {
          av = String(a.name || a.id || '');
          bv = String(b.name || b.id || '');
          return av.localeCompare(bv, 'zh-CN') * dir;
        }
        av = Number(a[key]) || 0;
        bv = Number(b[key]) || 0;
        return (av - bv) * dir;
      });

      return list;
    },

    // ====== 排序/筛选方法 ======
    sortBy(key) {
      if (this.sortKey === key) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortKey = key;
        this.sortDir = 'desc';
      }
    },

    resetFilter() {
      this.filterStatus = 'all';
      this.filterSearch = '';
      this.filterCpaMin = null;
      this.filterCpaMax = null;
    },

    switchAccount(id) {
      this.currentAccount = id;
      this.loadData();  // 切换账户重新加载
    },

    switchPlatform(p) {
      if (p !== 'oceanengine') {
        this.toastShow(`${p === 'tencent' ? '腾讯广告' : '快手磁力'} 敬请期待`, 'info');
        return;
      }
      this.currentPlatform = p;
    },

    // 当前账户名（供顶部缩略按钮显示）
    get currentAccountName() {
      const a = this.accounts.find(x => x.id === this.currentAccount);
      return a ? a.name : '';
    },

    // 平台中文标签
    platformLabel(p) {
      return p === 'oceanengine' ? '巨量' : p === 'tencent' ? '腾讯' : p === 'kuaishou' ? '快手' : p;
    },

    // ====== ECharts 渲染 ======
    renderCharts(summary) {
      this._renderTrend(summary);
      this._renderDist(summary);
    },

    _renderTrend(summary) {
      const el = this.$refs.trendChart;
      if (!el || typeof echarts === 'undefined') return;
      if (!this._charts.trend) this._charts.trend = echarts.init(el, 'dark');
      const trend = summary.trend;
      const hours = trend?.hours || [];
      const spendSeries = trend?.spend || [];
      const leadsSeries = trend?.leads || [];
      this._charts.trend.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis' },
        legend: { data: ['消耗', '线索'], textStyle: { color: '#e5e5e5' } },
        grid: { left: 50, right: 50, top: 40, bottom: 30 },
        xAxis: { type: 'category', data: hours, axisLabel: { color: '#999' } },
        yAxis: [
          { type: 'value', name: '消耗', axisLabel: { color: '#999' }, splitLine: { lineStyle: { color: '#333' } } },
          { type: 'value', name: '线索', axisLabel: { color: '#999' } },
        ],
        series: [
          { name: '消耗', type: 'line', smooth: true, data: spendSeries,
            itemStyle: { color: UP_COLOR }, areaStyle: { opacity: 0.2 } },
          { name: '线索', type: 'line', smooth: true, yAxisIndex: 1, data: leadsSeries,
            itemStyle: { color: DOWN_COLOR } },
        ],
      });
    },

    _renderDist(summary) {
      const el = this.$refs.distChart;
      if (!el || typeof echarts === 'undefined') return;
      if (!this._charts.dist) this._charts.dist = echarts.init(el, 'dark');
      const dist = summary.dist || [];
      this._charts.dist.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item', formatter: '{b}: ¥{c}' },
        legend: { type: 'scroll', orient: 'vertical', right: 10, top: 'center', textStyle: { color: '#e5e5e5' } },
        series: [{
          type: 'pie', radius: ['40%', '70%'], center: ['40%', '50%'],
          data: dist, label: { color: '#e5e5e5' },
        }],
      });
    },

    _resizeCharts() {
      Object.values(this._charts).forEach(c => c?.resize());
    },

    // ====== 工具 ======
    fmtMoney(v) {
      const n = Number(v) || 0;
      return '¥' + n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    },
    fmtNum(v, d = 2) {
      const n = Number(v) || 0;
      return n.toFixed(d);
    },
    statusColor(s) {
      s = s || '';
      if (s.includes('启用')) return '#22c55e';
      if (s.includes('暂停')) return '#f59e0b';
      return '#999';
    },
    // CPA 涨跌色（高于均值=红，低于=绿）
    cpaColor(cpa, avg) {
      return Number(cpa) > Number(avg) ? UP_COLOR : DOWN_COLOR;
    },

    // ====== 操作面板（Step2） ======
    // 判断计划是否处于可恢复（暂停/未投放）状态
    isPaused(c) {
      const s = c.rawStatus || c.status || '';
      // "启用中" / "投放中" 表示活跃；其他均视为可恢复
      return !s.includes('启用') && !s.includes('投放中');
    },

    // 统一构造写操作请求 body（带 planName，供 worker 直接定位 CDP 行）
    _buildActionBody(type, c, extra = {}) {
      return {
        type,
        campaign_id: c.id || c.campaignId || '',
        planName: c.name || c.campaignName || '',
        source: 'dashboard',
        ...extra,
      };
    },

    // 暂停/启用
    async togglePause(c) {
      const type = this.isPaused(c) ? 'resume' : 'pause';
      const label = type === 'pause' ? '暂停' : '启用';
      if (!confirm(`确认${label}计划「${c.name || c.id}」?`)) return;
      try {
        const r = await fetch('/api/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this._buildActionBody(type, c)),
        });
        const data = await r.json();
        if (data.ok) {
          // 本地乐观更新
          c.rawStatus = type === 'pause' ? '暂停' : '启用中';
          c.status = c.rawStatus;
          c.optStatus = type === 'pause' ? 3 : 1;
          this.toastShow(`${label}指令已入队`, 'success');
        } else {
          this.toastShow(`${label}失败: ${data.error || ''}`, 'error');
        }
      } catch (e) {
        this.toastShow(`${label}失败: ${e.message}`, 'error');
      }
    },

    // 调预算弹窗
    openBudgetModal(c) {
      this.modal = {
        show: true, type: 'adjust_budget',
        title: '调整预算',
        campaignId: c.id || c.campaignId,
        campaignName: c.name || c.campaignName || c.id,
        oldValue: Number(c.budget) || 0,
        value: Number(c.budget) || 0,
      };
    },

    // 调出价弹窗
    openBidModal(c) {
      const bid = parseFloat(String(c.bid || '').replace(/[^\d.]/g, '')) || 0;
      this.modal = {
        show: true, type: 'adjust_bid',
        title: '调整出价',
        campaignId: c.id || c.campaignId,
        campaignName: c.name || c.campaignName || c.id,
        oldValue: bid,
        value: bid,
      };
    },

    closeModal() {
      this.modal.show = false;
    },

    async submitModal() {
      const m = this.modal;
      if (!m.value && m.value !== 0) {
        this.toastShow('请输入有效数值', 'error');
        return;
      }
      try {
        const r = await fetch('/api/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: m.type,
            campaign_id: m.campaignId,
            planName: m.campaignName,
            source: 'dashboard',
            value: Number(m.value),
          }),
        });
        const data = await r.json();
        if (data.ok) {
          // 本地乐观更新
          const c = this.campaigns.find(x => (x.id || x.campaignId) === m.campaignId);
          if (c) {
            if (m.type === 'adjust_budget') c.budget = Number(m.value);
            if (m.type === 'adjust_bid') c.bid = String(m.value);
          }
          this.toastShow(`${m.title}指令已入队`, 'success');
          this.closeModal();
        } else {
          this.toastShow(`${m.title}失败: ${data.error || ''}`, 'error');
        }
      } catch (e) {
        this.toastShow(`${m.title}失败: ${e.message}`, 'error');
      }
    },

    // ====== 告警执行按钮 ======
    // 告警可执行操作映射：按类型返回建议操作列表
    alertActions(a) {
      const cid = a.campaignId || '';
      const cname = a.campaignName || '';
      const base = { id: cid, name: cname, campaignId: cid, campaignName: cname };
      switch (a.type) {
        case 'budget_cap':
          // 预算触顶 → 追加预算（打开弹窗）
          return [{ ...base, op: 'adjust_budget', label: '追加预算', icon: '¥', cls: 'btn-budget' }];
        case 'high_cpa':
          // 高 CPA → 降价 或 暂停
          return [
            { ...base, op: 'adjust_bid', label: '降出价', icon: '₵', cls: 'btn-bid' },
            { ...base, op: 'pause', label: '暂停', icon: '⏸', cls: 'btn-pause' },
          ];
        case 'zero_conv':
          // 零转化 → 暂停 或 降价
          return [
            { ...base, op: 'pause', label: '暂停', icon: '⏸', cls: 'btn-pause' },
            { ...base, op: 'adjust_bid', label: '降出价', icon: '₵', cls: 'btn-bid' },
          ];
        case 'cpa_rise':
          // CPA 上涨 → 降价
          return [{ ...base, op: 'adjust_bid', label: '降出价', icon: '₵', cls: 'btn-bid' }];
        case 'pacing_fast':
          // 消耗过快 → 降价 或 暂停
          return [
            { ...base, op: 'adjust_bid', label: '降出价', icon: '₵', cls: 'btn-bid' },
            { ...base, op: 'pause', label: '暂停', icon: '⏸', cls: 'btn-pause' },
          ];
        case 'budget':
          // 接近日预算上限 → 追加预算
          return [{ ...base, op: 'adjust_budget', label: '追加预算', icon: '¥', cls: 'btn-budget' }];
        case 'speed':
          // 消耗速度过快 → 降价
          return [{ ...base, op: 'adjust_bid', label: '降出价', icon: '₵', cls: 'btn-bid' }];
        case 'pacing_slow':
          // 消耗过慢 → 提价
          return [{ ...base, op: 'adjust_bid', label: '提出价', icon: '↑', cls: 'btn-resume' }];
        default:
          return [];
      }
    },

    // 执行告警建议操作
    async execAlertAction(a, action) {
      const c = { id: action.id, name: action.name, campaignId: action.id, campaignName: action.name };
      if (action.op === 'pause') {
        await this.togglePause(c);
      } else if (action.op === 'adjust_budget') {
        this.openBudgetModal(c);
      } else if (action.op === 'adjust_bid') {
        this.openBidModal(c);
      }
    },

    // ====== Toast ======
    toastShow(msg, type = 'info') {
      this.toast = { show: true, msg, type };
      // 3s 后自动关闭
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { this.toast.show = false; }, 3000);
    },
  };
}

// 暴露到全局供 Alpine x-data 使用
window.dashboardApp = dashboardApp;
