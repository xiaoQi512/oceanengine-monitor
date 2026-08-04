// dashboard-v2.js - Live Streaming Management v2
// 数据模型骨架：暂不实现 API 调用，只搭数据结构
// 关键设计：
//   1. Chart.js 实例（_trendChart）用模块作用域 let 声明，不放入 Alpine 响应式对象
//   2. $watch 监听 trendData 数组，数据变化时调用 chart.update() 增量刷新（非销毁重建）
//   3. 两套 Tab 状态：顶层 activeTab（全部/分组/AI建议/操作审计）+ opsTab（queue/pending/audit）

const UP = '#ef4444', DOWN = '#22c55e';

// Chart.js 实例引用：放模块作用域，避免被 Alpine 响应式代理
let _trendChart = null;
// tooltip 数据引用（模块级，供 Chart.js tooltip callback 访问）
let timestamps = [], top5Data = [], convBreakdownData = [];

function dashV2() {
  return {
    // === 顶层状态 ===
    loading: false,
    lastUpdate: '',
    error: '',
    activeTab: 'all',  // all | grouped | ai | ops
    toast: { show: false, msg: '', type: 'info' },
    _poll: null,
    _lastTs: 0,

    // === 直播状态 ===
    isLive: false,
    currentAnchor: '',
    currentShiftLabel: '',

    // === 排班 ===
    shifts: [],
    shiftCount: 0,

    // === KPI（与 v1 字段一致，便于后续对接 /api/live-status） ===
    kpi: {
      totalSpend: 0, liveSpend: 0, videoSpend: 0,
      totalLeads: 0, totalConversions: 0,
      totalMsgOpen: 0, totalMsgLead: 0,
      avgCpl: 0, liveCpl: 0, videoCpl: 0,
      privateMsg: 0, dailyBudget: 45000,
      aiRegionsSpend: 0,
    },
    // 消耗速度数据（来自 5m 快照的 _rolling）
    _rolling: { last5min: 0, convLast5min: 0 },

    // === 账号 ===
    accountCards: [],

    // === 推送日志 ===
    pushLog: [],

    // === 班次明细 ===
    shiftData: [],

    // === 趋势图数据（对应 /api/snapshots/trend 返回结构） ===
    // spend 是累计值；前端画"每5分钟增量"时需做相邻差分
    trendData: {
      labels: [],
      spend: [],
      cpl: [],
      cpm: [],
      conversions: [],
      impressions: [],
      activeCount: [],
      planSpend: [],
      spendingCount: [],
      deliveringCount: [],
      totalPlanCount: 0,
      pausedPlanCount: 0,
      convBreakdown: [],
      top5PerPoint: [],
      baseSpend: 0,
      baseConversions: 0,
      baseImpressions: 0,
    },
    trendMode: 'delta',  // 默认显示5分钟增量

    // === AI 学习数据（对应 /api/ai/learning-data 返回结构） ===
    aiData: {
      rules: [],
      recentActions: [],
      anomalies: [],
      summary: { totalAudits: 0, evaluatedActions: 0, rulesCount: 0 },
    },
    aiLoading: false,
    _aiLoaded: false,  // 首次切换到 AI Tab 才加载

    // === 分组数据 ===
    spendingGroups: {
      '简单投': { summary: emptyGroupSummary('简单投'), plans: [] },
      '画面直投': { summary: emptyGroupSummary('画面直投'), plans: [] },
      '短引直': { summary: emptyGroupSummary('短引直'), plans: [] },
    },
    inactiveGroups: {
      '简单投': { summary: emptyGroupSummary('简单投'), plans: [] },
      '画面直投': { summary: emptyGroupSummary('画面直投'), plans: [] },
      '短引直': { summary: emptyGroupSummary('短引直'), plans: [] },
    },
    totalSummary: emptyGroupSummary('全部'),
    inactivePeriod: (() => {
      try {
        const v = Number(localStorage.getItem('dashboard.inactivePeriod'));
        return [1, 3, 7].includes(v) ? v : 7;
      } catch {
        return 7;
      }
    })(),
    expandedGroups: { '简单投': true, '画面直投': true, '短引直': false },
    inactiveExpanded: (() => {
      const def = { '简单投': true, '画面直投': true, '短引直': true };
      try {
        return { ...def, ...JSON.parse(localStorage.getItem('dashboard.inactiveExpanded') || '{}') };
      } catch {
        return def;
      }
    })(),
    _inactive7Map: null,
    _inactivePeriodMap: null,

    // === 操作面板（内联在 HTML x-data 中，独立作用域，这里不留状态） ===

    // === 计算属性 ===
    get todayLabel() {
      const d = new Date();
      return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    },
    get weekdayLabel() {
      const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return days[new Date().getDay()];
    },
    get budgetPct() {
      return this.kpi.dailyBudget > 0 ? Math.round(this.kpi.totalSpend / this.kpi.dailyBudget * 100) : 0;
    },
    get speedPer5min() { return Number(this._rolling.last5min || 0); },
    get speedPerHour() { return Math.round(this.speedPer5min * 12); },
    get msgRetainRate() {
      return this.kpi.totalMsgOpen > 0 ? (this.kpi.totalMsgLead / this.kpi.totalMsgOpen * 100).toFixed(1) + '%' : '--';
    },
    get msgCost() {
      return this.kpi.totalMsgOpen > 0 ? Number((this.kpi.totalSpend / this.kpi.totalMsgOpen).toFixed(0)) : 0;
    },
    get deliveringPlanCount() {
      const last = this.trendData.deliveringCount;
      if (!last || !last.length) return 0;
      for (let i = last.length - 1; i >= 0; i--) if (last[i] !== null && last[i] !== undefined) return last[i];
      return 0;
    },
    // 飞书推送: 过滤 5min/15min 常规检查，只显示主力监控、余额告警、预算告警等
    get filteredPushLog() {
      return (this.pushLog || []).filter(p => {
        const t = p.type || '';
        return !t.includes('5min') && !t.includes('15min');
      });
    },
    fmtLiveElapsed() {
      if (!this.currentAnchor) return '';
      for (const s of this.shifts) {
        if (s.status !== 'live') continue;
        const [sh, sm] = s.start.split(':').map(Number);
        const startMin = sh * 60 + sm;
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        const elapsed = nowMin - startMin;
        if (elapsed < 0) return '';
        const h = Math.floor(elapsed / 60);
        const m = elapsed % 60;
        return h > 0 ? h + 'h' + m + 'min' : m + 'min';
      }
      return '';
    },
    // 各分组计划总数（用于 Tab 角标）
    get allPlansCount() {
      return this.totalSummary.total || 0;
    },

    // === 生命周期 ===
    init() {
      this.loadData();
      // [v2 fix] 轮询加 in-flight 保护，避免慢请求叠加
      this._poll = setInterval(() => { if (!this.loading) this.loadData(); }, 30000);
      // 趋势图初始化（骨架阶段先建空图，后续 loadData 填数据）
      this.$nextTick(() => this.initTrendChart());
      // 监听 trendData 变化，自动刷新图表（用 $watch，无需手动调用 update）
      this.$watch('trendData', (newVal) => this.updateTrendChart(newVal));
      // 数据加载后自动滚动到当前直播班次
      this.$watch('shifts', () => this.$nextTick(() => this.scrollToLiveShift()));
    },

    destroy() {
      if (this._poll) clearInterval(this._poll);
      if (_trendChart) { _trendChart.destroy(); _trendChart = null; }
      clearTimeout(this._tt);  // 清理 toast 残留定时器
    },

    // === 数据加载（4 个 API 并行，allSettled 容错） ===
    async loadData() {
      this.loading = true;
      this.error = '';
      try {
        const results = await Promise.allSettled([
          fetch('/api/live-status', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
          fetch('/api/snapshots/5m', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
          fetch('/api/snapshots/trend', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
          fetch('/api/campaigns/grouped', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
        ]);

        // [0] /api/live-status -> 直播状态/排班/账号/推送日志/班次明细/KPI
        if (results[0].status === 'fulfilled' && results[0].value) {
          const d = results[0].value;
          this.isLive = d.isLive || false;
          this.currentAnchor = d.currentAnchor || '';
          this.shifts = d.shifts || [];
          this.shiftCount = this.shifts.length;
          this.shiftData = d.shiftData || [];
          this.pushLog = d.pushLog || [];
          this.accountCards = d.accounts || [];
          if (d.kpi) this.kpi = { ...this.kpi, ...d.kpi };
          this.currentShiftLabel = this._currentShiftLabel();
        }

        // [1] /api/snapshots/5m -> 最新快照（兜底 kpi；如果 live-status 的字段更全则不被覆盖）
        // 5m 快照字段名是 accountSpend/accountBudget/totalConv；live-status 的 kpi 已是同源
        // 命名（已修过 live-data.mjs 兼容）→ 这里只在字段缺失时填充
        if (results[1].status === 'fulfilled' && results[1].value && results[1].value.latest) {
          const s = results[1].value.latest;
          const v = {
            totalSpend: Number(s.accountSpend) || Number(s.summarySpend) || 0,
            dailyBudget: Number(s.accountBudget) || 0,
            totalLeads: Number(s.totalConv) || 0,
            totalConversions: Number(s.totalConv) || 0,
            totalMsgOpen: Number(s.totalMsgOpen) || 0,
            totalMsgLead: Number(s.totalMsgLead) || 0,
          };
          if (v.totalSpend > 0 && (!this.kpi.totalSpend || this.kpi.totalSpend === 0)) this.kpi.totalSpend = v.totalSpend;
          if (v.dailyBudget > 0 && (!this.kpi.dailyBudget || this.kpi.dailyBudget === 45000)) this.kpi.dailyBudget = v.dailyBudget;
          if (v.totalLeads > 0 && (!this.kpi.totalLeads || this.kpi.totalLeads === 0)) {
            this.kpi.totalLeads = v.totalLeads;
            this.kpi.totalConversions = v.totalConversions;
          }
          // 开口/留资每次轮询都更新(不是"首次填充"逻辑——每次都可能变化)
          this.kpi.totalMsgOpen = v.totalMsgOpen;
          this.kpi.totalMsgLead = v.totalMsgLead;
          if (this.kpi.totalSpend > 0 && this.kpi.totalLeads > 0 && (!this.kpi.avgCpl || this.kpi.avgCpl === 0)) {
            this.kpi.avgCpl = Number((this.kpi.totalSpend / this.kpi.totalLeads).toFixed(2));
          }
          // [v1.5] 消耗速度数据
          if (s._rolling) {
            this._rolling.last5min = Number(s._rolling.last5min) || 0;
            this._rolling.convLast5min = Number(s._rolling.convLast5min) || 0;
          }
        }

        // [2] /api/snapshots/trend -> 趋势图数据（5分钟快照 + 15分钟计划级双源）
        if (results[2].status === 'fulfilled' && results[2].value) {
          const t = results[2].value;
          this.trendData = {
            labels: t.labels || [],
            spend: t.spend || [],
            cpl: t.cpl || [],
            cpm: t.cpm || [],
            conversions: t.conversions || [],
            impressions: t.impressions || [],
            activeCount: t.activeCount || [],
            planSpend: t.planSpend || [],
            spendingCount: t.spendingCount || [],
            deliveringCount: t.deliveringCount || [],
            totalPlanCount: typeof t.totalPlanCount === 'number' ? t.totalPlanCount : 0,
            pausedPlanCount: typeof t.pausedPlanCount === 'number' ? t.pausedPlanCount : 0,
            convBreakdown: t.convBreakdown || [],
            top5PerPoint: t.top5PerPoint || [],
            timestamps: t.timestamps || [],
            baseSpend: Number(t.baseSpend) || 0,
            baseConversions: Number(t.baseConversions) || 0,
            baseImpressions: Number(t.baseImpressions) || 0,
          };
        }

        // [3] /api/campaigns/grouped -> 分组数据(有消耗/未启动)
        if (results[3].status === 'fulfilled' && results[3].value) {
          const d = results[3].value;
          const norm = p => this._normalizePlan(p);
          if (d.spending && d.spending.groups) {
            for (const gname of Object.keys(this.spendingGroups)) {
              const g = d.spending.groups[gname];
              if (g) this.spendingGroups[gname] = { summary: g.summary || emptyGroupSummary(gname), plans: (g.plans || []).map(norm) };
            }
          }
          if (d.inactive && d.inactive.groups) {
            for (const gname of Object.keys(this.inactiveGroups)) {
              const g = d.inactive.groups[gname];
              if (g) this.inactiveGroups[gname] = { summary: g.summary || emptyGroupSummary(gname), plans: (g.plans || []).map(norm) };
            }
          }
          this.totalSummary = d.totalSummary || emptyGroupSummary('全部');
          if (this._inactive7Map) {
            this.applyInactiveData();
          } else {
            await this.toggleInactivePeriod(this.inactivePeriod);
          }
        }

        this.lastUpdate = new Date().toLocaleTimeString('zh-CN');
        this._lastTs = Date.now();
        // 如果 AI Tab 已加载过，随主轮询刷新
        if (this._aiLoaded) this.loadAiData(true);
      } catch (e) {
        this.error = e.message || '加载失败';
        console.error('loadData error', e);
      } finally {
        this.loading = false;
      }
    },

    // 归一化计划字段：兜底 null 值，避免前端渲染 NaN
    _normalizePlan(p) {
      return {
        ...p,
        spend: Number(p.spend) || 0,
        leads: Number(p.leads) || 0,
        conversions: Number(p.conversions) || 0,
        cpa: Number(p.cpa) || 0,
        budget: Number(p.budget) || 0,
        cpm: Number(p.cpm) || 0,
        ctr: Number(p.ctr) || 0,
        cvr: Number(p.cvr) || 0,
        _histSpend: 0, _histLeads: 0, _histCpl: 0, _histCpm: 0, _histCtr: 0,
        status: p.status || '未知',
      };
    },

    // 异常计划判定: 消耗>500 且 (CPL>150 或 0线索)
    // 用于分组卡片红色高亮
    isAnomaly(p) {
      if (p.spend < 500) return false;
      if (p.leads === 0) return true;
      // CPL = spend / leads
      const cpl = p.spend / p.leads;
      return cpl > 150;
    },

    // 延迟归因判定: spend=0 但 leads>0
    // 短引直等类型常见
    hasDelayedAttribution(p) {
      return p.spend === 0 && p.leads > 0;
    },

    // 自动滚动到当前直播班次（让用户立即看到正在直播的班次）
    scrollToLiveShift() {
      const timeline = this.$refs.timeline;
      if (!timeline) return;
      const liveRow = timeline.querySelector('.tl-row.active, .tl-row.live');
      if (liveRow) {
        liveRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },

    // === 趋势图 ===
    initTrendChart() {
      const ctx = this.$refs.trendCanvas;
      if (!ctx || typeof Chart === 'undefined') return;
      // 销毁旧实例防止多重叠加（Alpine 热重载或重复 init 可能触发）
      if (_trendChart) { _trendChart.destroy(); _trendChart = null; }
      _trendChart = new Chart(ctx, {
        type: 'line',
        plugins: [{
          // 自定义 plugin：高亮数据集时在每个节点上方绘制数值
          id: 'hoverValueLabels',
          afterDatasetsDraw(chart) {
            const ds = chart.data.datasets;
            // 找到高亮的数据集（borderWidth=4）
            let hlIdx = -1;
            for (let i = 0; i < ds.length; i++) {
              if (ds[i].type === 'bar') continue;
              if (ds[i].borderWidth === 4) { hlIdx = i; break; }
            }
            if (hlIdx < 0) return;
            const meta = chart.getDatasetMeta(hlIdx);
            if (!meta || !meta.data) return;
            const ctx2 = chart.ctx;
            const label = ds[hlIdx].label;
            ctx2.save();
            ctx2.font = '10px -apple-system, sans-serif';
            ctx2.textAlign = 'center';
            ctx2.textBaseline = 'bottom';
            for (let i = 0; i < meta.data.length; i++) {
              const pt = meta.data[i];
              if (!pt) continue;
              const v = ds[hlIdx].data[i];
              if (v === null || v === undefined) continue;
              let txt;
              if (label === '消耗') txt = '¥' + Number(v).toFixed(0);
              else if (label === 'CPL' || label === 'CPM') txt = '¥' + Number(v).toFixed(1);
              else txt = String(v);
              // 背景
              const w = ctx2.measureText(txt).width + 8;
              ctx2.fillStyle = 'rgba(15,23,42,0.85)';
              ctx2.fillRect(pt.x - w / 2, pt.y - 18, w, 14);
              // 文字
              const colors = ['消耗' === label ? '#ef4444' : label === 'CPL' ? '#3b82f6' : label === 'CPM' ? '#8b5cf6' : '#94a3b8'];
              ctx2.fillStyle = colors[0];
              ctx2.fillText(txt, pt.x, pt.y - 6);
            }
            ctx2.restore();
          },
        }],
        data: {
          labels: this.trendData.labels,
          datasets: [
            // [Y轴1 - 金额] 5min消耗折线
            { label: '消耗', data: this.trendData.spend, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', tension: 0.35, fill: true, yAxisID: 'y', borderWidth: 2 },
            // [Y轴2 - 单价] CPL/CPM 折线
            { label: 'CPL', data: this.trendData.cpl, borderColor: '#3b82f6', tension: 0.35, fill: false, yAxisID: 'y1', borderWidth: 1.5 },
            { label: 'CPM', data: this.trendData.cpm, borderColor: '#8b5cf6', tension: 0.35, fill: false, yAxisID: 'y1', borderWidth: 1.5 },
            // [Y轴3 - 数量] 转化柱状
            { label: '转化', data: this.trendData.conversions, type: 'bar', backgroundColor: 'rgba(34,197,94,0.35)', borderColor: '#22c55e', yAxisID: 'y2', borderWidth: 1, barPercentage: 0.6, categoryPercentage: 0.7 },
            // [Y轴3 - 数量] 在投计划柱状（campaigns.status='投放中'）
            { label: '在投计划', data: this.trendData.deliveringCount || [], type: 'bar', backgroundColor: 'rgba(148,163,184,0.15)', borderColor: 'rgba(148,163,184,0.4)', yAxisID: 'y2', borderWidth: 1, barPercentage: 0.6, categoryPercentage: 0.7 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          onHover: (event, elements, chart) => {
            // 鼠标悬停在数据点上时，高亮对应数据集的整条折线 + 显示节点数值
            chart.data.datasets.forEach((ds, i) => {
              if (ds.type === 'bar') return;
              if (ds._origWidth === undefined) ds._origWidth = ds.borderWidth || 1.5;
            });
            if (!elements || !elements.length) {
              chart.data.datasets.forEach((ds, i) => {
                if (ds.type === 'bar') return;
                ds.borderWidth = ds._origWidth;
                ds.pointRadius = 0;  // 默认不显示点
                ds.pointLabels = { display: false };
              });
            } else {
              const hoveredDsIndex = elements[0].datasetIndex;
              chart.data.datasets.forEach((ds, i) => {
                if (ds.type === 'bar') return;
                ds.borderWidth = (i === hoveredDsIndex) ? 4 : 1;
                // 高亮的折线显示每个节点的数值标签
                if (i === hoveredDsIndex) {
                  ds.pointRadius = 4;  // 显示节点点
                  ds.datalabels = { display: true };
                } else {
                  ds.pointRadius = 0;
                }
              });
            }
            chart.update('none');
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(15,23,42,0.95)',
              borderColor: '#334155',
              borderWidth: 1,
              padding: 12,
              titleFont: { size: 12 },
              bodyFont: { size: 11 },
              callbacks: {
                title: (ctx) => {
                  const i = ctx[0].dataIndex;
                  const time = timestamps && timestamps[i] ? new Date(timestamps[i]) : null;
                  return time ? time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + ' · ' + time.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '';
                },
                label: (ctx) => {
                  const i = ctx.dataIndex;
                  const ds = ctx.dataset;
                  const v = ds.data[i] ?? 0;
                  if (ds.label === '消耗') { return '5min消耗: ¥' + Number(v).toFixed(2); }
                  if (ds.label === 'CPL') { return '5min CPL: ¥' + Number(v).toFixed(2); }
                  if (ds.label === 'CPM') { return '5min CPM: ¥' + Number(v).toFixed(2); }
                  if (ds.label === '转化') { return '5min转化: ' + v + ' 条'; }
                  if (ds.label === '在投计划') { return '在投计划: ' + v + ' 个'; }
                  return '';
                },
                afterBody: (ctx) => {
                  const i = ctx[0].dataIndex;
                  const top5 = top5Data && top5Data[i] ? top5Data[i] : [];
                  const cb = convBreakdownData && convBreakdownData[i] ? convBreakdownData[i] : null;
                  let lines = [];
                  if (cb) {
                    lines.push('');
                    const totalConv = (cb.msgLead || 0) + (cb.formSubmit || 0) + (cb.other || 0);
                    lines.push('转化分类 合计: ' + totalConv + ' (私信留资: ' + cb.msgLead + ' 表单提交: ' + cb.formSubmit + ' 其他: ' + cb.other + ')');
                  }
                  if (top5.length) {
                    lines.push('');
                    lines.push('5min消耗TOP5:');
                    const trendTag = (t) => {
                      if (t === '起量') return '🔥';
                      if (t === '掉量') return '📉';
                      if (t === '稳定') return '➡';
                      if (t === 'NEW') return '✨';
                      return '';
                    };
                    top5.forEach((p, j) => {
                      // changeRate 为倍数（当前增量/上一增量），显示环比百分比
                      const rateStr = p.changeRate !== null ? (p.changeRate >= 1 ? '+' : '') + ((p.changeRate - 1) * 100).toFixed(0) + '%' : 'NEW';
                      const cplStr = p.leads > 0 ? '¥' + p.cpl : '-';
                      // 消耗/CPL 对齐：固定宽度，消耗 9 字符（¥9999.99），CPL 8 字符（¥999.99）
                      const spendStr = ('¥' + p.spend).padEnd(10);
                      const rateField = (rateStr).padEnd(7);
                      const cplField = cplStr.padEnd(9);
                      lines.push('  ' + (j + 1) + '. ' + trendTag(p.trend) + ' ' + spendStr + rateField + cplField + p.name);
                    });
                  }
                  return lines;
                },
              },
            },
          },
          scales: {
            x: { grid: { color: 'rgba(148,163,184,0.05)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
            // Y轴1（左）- 金额：消耗/计划消耗
            y: {
              position: 'left',
              grid: { color: 'rgba(148,163,184,0.08)' },
              ticks: { color: '#ef4444', font: { size: 10 }, callback: (v) => '¥' + v },
              title: { display: true, text: '消耗 (¥)', color: '#ef4444', font: { size: 10 } },
            },
            // Y轴2（右）- 单价：CPL/CPM
            y1: {
              position: 'right',
              grid: { drawOnChartArea: false },
              ticks: { color: '#3b82f6', font: { size: 10 }, callback: (v) => '¥' + v },
              title: { display: true, text: 'CPL/CPM (¥)', color: '#3b82f6', font: { size: 10 } },
            },
            // Y轴3（右2，堆叠到 y1 右侧）- 数量：转化/在投计划
            y2: {
              position: 'right',
              grid: { drawOnChartArea: false },
              min: 0,
              max: 20,
              ticks: { color: '#22c55e', font: { size: 10 }, stepSize: 1 },
              title: { display: true, text: '数量', color: '#22c55e', font: { size: 10 } },
              offset: true,  // 避免与 y1 重叠
            },
          },
        },
      });
    },

    updateTrendChart(newData) {
      if (!_trendChart) return;
      const labels = newData.labels;
      if (!labels || labels.length === 0) return;  // 空数据不更新图表
      let displaySpend = newData.spend;
      let displayConv = newData.conversions;
      let displayPlanSpend = newData.planSpend || [];
      let displayDeliveringCount = newData.deliveringCount || [];
      if (this.trendMode === 'delta') {
        // 差分：v 或上一格点为 null/NaN 时标记 NaN（JSON 把 NaN 序列化为 null）
        const isVoid = v => v === null || v === undefined || isNaN(v);
        displaySpend = newData.spend.map((v, i) =>
          i === 0
            ? (isVoid(v) || isVoid(newData.baseSpend) ? NaN : Number(Math.max(0, v - newData.baseSpend).toFixed(2)))
            : (isVoid(v) || isVoid(newData.spend[i - 1]) ? NaN : Number((v - newData.spend[i - 1]).toFixed(2))));
        displayConv = newData.conversions.map((v, i) =>
          i === 0
            ? (isVoid(v) ? NaN : v - (newData.baseConversions || 0))
            : (isVoid(v) || isVoid(newData.conversions[i - 1]) ? NaN : v - newData.conversions[i - 1]));
        // 增量 CPL：deltaSpend / deltaConversions
        const deltaCplArr = [];
        for (let i = 0; i < displaySpend.length; i++) {
          if (isNaN(displaySpend[i]) || isNaN(displayConv[i]))
            deltaCplArr.push(NaN);
          else if (displayConv[i] <= 0)
            deltaCplArr.push(Number(displaySpend[i].toFixed(2)));  // 转化=0时CPL=消耗
          else
            deltaCplArr.push(Number((displaySpend[i] / displayConv[i]).toFixed(2)));
        }
        _trendChart.data.datasets[1].data = deltaCplArr;
        // 增量 CPM：deltaSpend / deltaImpressions * 1000
        const deltaCpmArr = [];
        const imprArr = newData.impressions || [];
        for (let i = 0; i < displaySpend.length; i++) {
          const deltaImpr = i === 0
            ? (isVoid(imprArr[0]) ? NaN : (imprArr[0] - (newData.baseImpressions || 0)))
            : (isVoid(imprArr[i]) || isVoid(imprArr[i - 1]) ? NaN : (imprArr[i] - imprArr[i - 1]));
          deltaCpmArr.push(
            isNaN(deltaImpr) || isNaN(displaySpend[i]) || deltaImpr <= 0 || displaySpend[i] <= 0
              ? NaN
              : Number(((displaySpend[i] / deltaImpr) * 1000).toFixed(2))
          );
        }
        _trendChart.data.datasets[2].data = deltaCpmArr;  // 5min CPM
        // 计划级数据不做差分（15分钟采样间隔不定）
        displayPlanSpend = displayPlanSpend.map(v => v ?? null);
        displayDeliveringCount = displayDeliveringCount.map(v => v ?? null);
      } else {
        // 累计模式：用后端返回的原始数据
        _trendChart.data.datasets[2].data = newData.cpm;
        _trendChart.data.datasets[1].data = newData.cpl;
      }
      _trendChart.data.labels = newData.labels;
      _trendChart.data.datasets[0].data = displaySpend;
      // CPL 已在 delta/cumulative 分支中赋值
      _trendChart.data.datasets[3].data = displayConv;
      _trendChart.data.datasets[4].data = displayDeliveringCount;
      // 更新 tooltip 数据引用（模块级变量）
      timestamps = newData.timestamps || [];
      top5Data = newData.top5PerPoint || [];
      convBreakdownData = newData.convBreakdown || [];
      _trendChart.update();  // 增量更新，非销毁重建
    },

    // 切换趋势图模式（累计/增量）
    toggleTrendMode() {
      this.trendMode = this.trendMode === 'cumulative' ? 'delta' : 'cumulative';
      this.updateTrendChart(this.trendData);
    },

    // === 分组展开/收起 ===
    toggleGroup(name) {
      this.expandedGroups[name] = !this.expandedGroups[name];
    },

    toggleInactiveGroup(name) {
      this.inactiveExpanded[name] = !this.inactiveExpanded[name];
      this._saveInactiveState();
    },

    // 未启动计划: 切换历史数据周期
    async fetchInactiveHistory(period) {
      const allIds = [];
      for (const gname of Object.keys(this.inactiveGroups))
        this.inactiveGroups[gname].plans.forEach(p => allIds.push(p.id));
      if (allIds.length === 0) return {};
      const r = await fetch('/api/campaigns/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planIds: allIds, period }),
      });
      const d = await r.json();
      const map = {};
      (d.plans || []).forEach(h => map[h.id] = h);
      return map;
    },

    applyInactiveData() {
      if (!this._inactive7Map) return;
      for (const gname of Object.keys(this.inactiveGroups)) {
        const g = this.inactiveGroups[gname];
        let plans = (g.plans || []).filter(p => Number((this._inactive7Map[p.id] || {}).spend || 0) > 0);
        if (this._inactivePeriodMap) {
          plans = plans.map(p => {
            const h = this._inactivePeriodMap[p.id] || { spend: 0, leads: 0, cpl: 0, cpm: 0, ctr: 0 };
            p._histSpend = h.spend;
            p._histLeads = h.leads;
            p._histCpl = h.cpl;
            p._histCpm = h.cpm;
            p._histCtr = h.ctr;
            return p;
          });
          plans.sort((a, b) => (b._histSpend || 0) - (a._histSpend || 0));
        }
        this.inactiveGroups[gname] = { summary: g.summary || emptyGroupSummary(gname), plans };
      }
    },

    _saveInactiveState() {
      try {
        localStorage.setItem('dashboard.inactivePeriod', String(this.inactivePeriod));
        localStorage.setItem('dashboard.inactiveExpanded', JSON.stringify(this.inactiveExpanded));
      } catch {}
    },

    async toggleInactivePeriod(period) {
      this.inactivePeriod = period;
      this._saveInactiveState();
      try {
        if (!this._inactive7Map) this._inactive7Map = await this.fetchInactiveHistory(7);
        this._inactivePeriodMap = await this.fetchInactiveHistory(period);
        this.applyInactiveData();
      } catch (e) { console.error('load history error', e); }
    },

    // 未启动计划: 启动
    async startInactivePlan(plan) {
      if (!confirm(`确认启动计划: ${plan.name} ?`)) return;
      try {
        const r = await fetch('/api/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'resume', campaign_id: plan.id, planName: plan.name, source: 'dashboard-v2' }),
        });
        const d = await r.json();
        if (d.ok) this.toastShow('启动信号已入队: ' + plan.name, 'success');
        else this.toastShow('启动失败: ' + (d.error || ''), 'error');
      } catch (e) { this.toastShow('启动失败: ' + e.message, 'error'); }
    },

    // === 操作面板（loadOps/rollbackAction 在 HTML 内联 x-data 中实现，独立作用域） ===

    tabStyle(name) {
      const active = this.opsTab === name;
      return 'padding:8px 16px;border:none;background:' + (active ? 'var(--blue)' : 'transparent') +
             ';color:' + (active ? '#fff' : 'var(--muted)') +
             ';cursor:pointer;font-size:14px;font-weight:600;border-radius:6px 6px 0 0;transition:all .2s';
    },

    // === 手动推送 ===
    async manualPush() {
      this.toastShow('正在触发手动推送...', 'info');
      try {
        const r = await fetch('/api/manual-push', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const d = await r.json();
        if (d.ok) this.toastShow('推送指令已入队', 'success');
        else this.toastShow('推送失败: ' + (d.error || ''), 'error');
      } catch (e) { this.toastShow('推送失败: ' + e.message, 'error'); }
    },

    // 班次明细补推：按 shiftLabel + date 发送信号
    async repushShift(d) {
      if (!d.pushed) return;
      const label = d.label || (d.start + '-' + d.end);
      this.toastShow('正在补推 ' + label + '...', 'info');
      try {
        const now = new Date();
        const date = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
        const r = await fetch('/api/repush', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shiftLabel: label, date }),
        });
        const d = await r.json();
        if (d.ok) this.toastShow('补推信号已发送 (' + label + ')', 'success');
        else this.toastShow('补推失败: ' + (d.error || ''), 'error');
      } catch (e) { this.toastShow('补推失败: ' + e.message, 'error'); }
    },

    // === AI 学习数据加载（首次切换到 AI Tab 时加载，之后随 loadData 一起刷新） ===
    async loadAiData(force = false) {
      if (this._aiLoaded && !force) return;
      if (this.aiLoading) return;  // 防抖：快速切换 Tab 时避免并发请求
      this.aiLoading = true;
      try {
        const r = await fetch('/api/ai/learning-data', { cache: 'no-store' });
        if (r.ok) {
          this.aiData = await r.json();
          this._aiLoaded = true;
        }
      } catch (e) { console.error('ai load error', e); }
      this.aiLoading = false;
    },

    // === Tab 切换 ===
    switchTab(tab) {
      this.activeTab = tab;
      if (tab === 'ai') this.loadAiData();
    },

    // === 计划操作（暂停/启用/调整预算） ===
    async planAction(plan, action) {      // action: 'pause' | 'resume' | 'adjust_budget'
      let body = {
        type: action,
        campaign_id: plan.id,
        planName: plan.name,
        source: 'dashboard-v2',
      };

      if (action === 'adjust_budget') {
        const current = plan.budget || 0;
        const input = prompt(`调整预算 · ${plan.name}\n当前预算: ¥${current}\n请输入新预算（元）:`, current);
        if (input === null) return;  // 取消
        const value = Number(input);
        if (!value || value <= 0) {
          this.toastShow('预算必须为正数', 'error');
          return;
        }
        body.value = value;
      }

      const actionLabel = { pause: '暂停', resume: '启用', adjust_budget: `调整预算为 ¥${body.value}` }[action];
      this.toastShow(`正在入队: ${actionLabel} · ${plan.name}`, 'info');

      try {
        const r = await fetch('/api/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (d.ok || d.queued || r.status === 200) {
          this.toastShow(`✓ 已入队: ${actionLabel}`, 'success');
          // 2 秒后刷新数据（给 worker 处理时间）
          setTimeout(() => this.loadData(), 2000);
        } else {
          this.toastShow('入队失败: ' + (d.error || '未知错误'), 'error');
        }
      } catch (e) {
        this.toastShow('请求失败: ' + e.message, 'error');
      }
    },

    // === 班次时间线辅助 ===
    _currentShiftLabel() {
      const now = new Date();
      const hm = now.getHours() * 60 + now.getMinutes();
      for (const s of this.shifts) {
        const [sh, sm] = s.start.split(':').map(Number);
        const [eh, em] = s.end.split(':').map(Number);
        const smin = sh * 60 + sm, emin = eh * 60 + em;
        if (hm >= smin && hm < emin) return s.anchor + ' 直播中 · ' + s.start + '-' + s.end;
      }
      if (this.shifts.length > 0) {
        const last = this.shifts[this.shifts.length - 1];
        const [eh, em] = last.end.split(':').map(Number);
        if (hm >= eh * 60 + em) return '今日直播已结束';
      }
      return '';
    },

    barWidth(s) {
      const [sh, sm] = s.start.split(':').map(Number);
      const [eh, em] = s.end.split(':').map(Number);
      const dur = eh * 60 + em - sh * 60 - sm;
      const maxDur = this.shifts.reduce((m, x) => {
        const [xsh, xsm] = x.start.split(':').map(Number);
        const [xeh, xem] = x.end.split(':').map(Number);
        return Math.max(m, xeh * 60 + xem - xsh * 60 - xsm);
      }, 120);
      return Math.round(dur / maxDur * 100);
    },

    // 当前直播班次的进度百分比
    shiftProgress(s) {
      if (s.status !== 'live') return 0;
      const [sh, sm] = s.start.split(':').map(Number);
      const [eh, em] = s.end.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      if (nowMin < startMin || nowMin >= endMin) return 0;
      return Math.round((nowMin - startMin) / (endMin - startMin) * 100);
    },

    // === 格式化 ===
    fmtMoney(v) { const n = Number(v) || 0; return '\xA5' + n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }); },
    fmtNum(v) { const n = Number(v) || 0; return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 }); },

    // === Toast ===
    toastShow(msg, type = 'info') {
      this.toast = { show: true, msg, type };
      clearTimeout(this._tt);
      this._tt = setTimeout(() => { this.toast.show = false; }, 3000);
    },
  };
}

// === 辅助函数（与后端 summarizeGroup 对应的空骨架） ===
function emptyGroupSummary(name) {
  return { name, spend: 0, leads: 0, cpl: 0, active: 0, paused: 0, total: 0 };
}

// === 状态标签辅助 ===
function statusTagClass(status) {
  if (!status) return 'tag-muted';
  if (status.includes('投放中')) return 'tag-live';
  if (status.includes('暂停')) return 'tag-paused';
  if (status.includes('超出预算') || status.includes('预算')) return 'tag-over';
  return 'tag-muted';
}

// 通过 alpine:init 确保在 Alpine.start() 扫描 DOM 之前完成注册
document.addEventListener('alpine:init', () => Alpine.data('dashV2', dashV2));
// 兜底: 如果 Alpine 已初始化则直接注册
if (typeof Alpine !== 'undefined' && Alpine.data) {
  Alpine.data('dashV2', dashV2);
}
window.dashV2 = dashV2;
