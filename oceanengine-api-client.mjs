// oceanengine-api-client.mjs — 巨量引擎 HTTP API 直连客户端 (v2.2)
// 直接调 OceanEngine 内部 API 获取 JSON 数据
// Cookie 过期时自动触发 CDP 登录流程
//
// 配置：复制 .env.example 为 .env 并填入真实值（TD-1 已于 2026-06-29 迁移）
//   OEC_EMAIL / OEC_PASSWORD / OEC_ACCOUNT_ID

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import { WebSocket } from 'ws';
import { getOceanEngineTab } from './cdp-client.mjs';
import { DATA_DIR } from './monitor-utils.mjs';

// ====== .env 加载（轻量实现，避免 dotenv 依赖） ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// ====== 常量 ======
const COOKIE_CACHE_FILE = path.join(DATA_DIR, '.oec-cookies.json');
const COOKIE_CACHE_TTL = 2 * 60 * 60 * 1000; // Cookie 缓存2小时 (实测session约2h)
const ACCOUNT_ID = process.env.OEC_ACCOUNT_ID || '1842681352509635';
const BASE_URL = 'https://ad.oceanengine.com';

// ====== 工具函数 ======
/** 获取本地日期字符串 YYYY-MM-DD（修复 toISOString() 使用UTC导致0-7点日期偏移） */
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ====== 失败日志限频：同类失败 5 分钟内只打印一次（跨进程共享状态，避免刷屏） ======
const FAIL_LOG_STATE_FILE = path.join(DATA_DIR, '.fail-log-state.json');
function failLogOnce(key, fn) {
  const now = Date.now();
  const WINDOW_MS = 5 * 60 * 1000;
  let state = {};
  try { state = JSON.parse(fs.readFileSync(FAIL_LOG_STATE_FILE, 'utf-8')); } catch {}
  if (now - (state[key] || 0) < WINDOW_MS) return;
  state[key] = now;
  try { fs.writeFileSync(FAIL_LOG_STATE_FILE, JSON.stringify(state)); } catch {}
  fn();
}

// ====== Cookie 提取（一次性，使用 CDP Network.getCookies） ======
async function extractCookiesFromBrowser() {
  console.log('  🍪 从浏览器提取 Cookie...');

  const tab = await getOceanEngineTab(['投放管理', '巨量引擎工作台']);
  
  // 浏览器未登录 → 尝试自动登录
  if (!tab) {
    const email = process.env.OEC_EMAIL || '';
    const password = process.env.OEC_PASSWORD || '';
    if (email && password) {
      console.log('  ⚠ 无巨量引擎标签页，触发自动登录...');
      const { autoLogin } = await import('./oec-auto-login.mjs');
      const result = await autoLogin(email, password);
      if (result.success) {
        try {
          if (fs.existsSync(COOKIE_CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(COOKIE_CACHE_FILE, 'utf-8'));
          }
        } catch {}
      }
      if (result.captcha) throw new Error('CAPTCHA_REQUIRED: 需要人工完成验证码');
    }
    throw new Error('未找到巨量引擎标签页且无法自动登录');
  }

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let cmdId = 1;
  const pending = new Map();

  function wsSend(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = cmdId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); }
      }, 10000);
    });
  }

  await new Promise((r, rej) => { ws.once('open', r); ws.once('error', rej); setTimeout(() => rej(new Error('ws timeout')), 8000); });
  ws.on('message', (data) => {
    const d = Buffer.isBuffer(data) ? data.toString() : String(data || '');
    let msg; try { msg = JSON.parse(d); } catch { return; }
    if (msg.id && pending.has(msg.id)) { const { resolve } = pending.get(msg.id); pending.delete(msg.id); resolve(msg); }
  });

  await wsSend('Network.enable');

  const result = await wsSend('Network.getCookies', {
    urls: ['https://ad.oceanengine.com', 'https://sso.oceanengine.com'],
  });
  const cookies = result?.result?.cookies || [];
  // URI编码cookie值，确保HTTP头仅含ASCII安全字符（如get_new_msg_timer_cycle含中文）
  const cookieString = cookies.map(c => `${c.name}=${encodeURIComponent(c.value)}`).join('; ');

  const uaResult = await wsSend('Runtime.evaluate', {
    expression: 'navigator.userAgent', returnByValue: true,
  });
  ws.close();

  const userAgent = uaResult?.result?.result?.value || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  const headers = {
    'Cookie': cookieString,
    'User-Agent': userAgent,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': `${BASE_URL}/promotion/promote-manage/project?aadvid=${ACCOUNT_ID}`,
    'Origin': BASE_URL,
    'Content-Type': 'application/json',
  };

  const cookieData = { cookies: cookieString, headers, expireAt: Date.now() + COOKIE_CACHE_TTL };
  fs.writeFileSync(COOKIE_CACHE_FILE, JSON.stringify(cookieData, null, 2));

  console.log(`  ✅ 提取 ${cookies.length} 个 Cookie (有效期至 ${new Date(cookieData.expireAt).toLocaleString()})`);
  return cookieData;
}

// ====== HTTP 请求发送 ======
async function apiRequest(url, options = {}) {
  const { method = 'GET', body, cookieData } = options;
  if (!cookieData?.headers) throw new Error('Cookie 未初始化');

  if (Date.now() > cookieData.expireAt) {
    console.log('  ⚠ Cookie 过期，重新提取...');
    Object.assign(cookieData, await extractCookiesFromBrowser());
  }

  const urlObj = new URL(url);
  const headers = { ...cookieData.headers, ...(options.headers || {}) };
  // 清理 Cookie 中的非ASCII字符（HTTP头仅允许ASCII）
  if (headers['Cookie']) {
    headers['Cookie'] = headers['Cookie'].replace(/[^\x20-\x7E]/g, '');
  // 从Cookie提取csrftoken作为X-CSRFToken请求头（Django双重提交Cookie反CSRF）
  const csrfMatch = (headers['Cookie'] || '').match(/csrftoken=([^;]+)/);
  if (csrfMatch) headers['X-CSRFToken'] = csrfMatch[1];

  }

  return new Promise((resolve, reject) => {
    const transport = urlObj.protocol === 'https:' ? https : http;
    const req = transport.request(url, { method, headers, timeout: 15000 }, (res) => {
      // ⚠️ 必须 setEncoding('utf8') —— 否则多字节中文字符跨越TCP分片时会乱码
      // 默认 data 事件 emit Buffer，逐片 toString('utf8') 会截断跨片的多字节序列
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ ok: false, status: res.statusCode, error: 'parse', raw: data.substring(0, 200) });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ====== 核心数据查询 ======

/**
 * 获取项目列表（含完整 metrics）
 * 逆向自前端网络请求，已验证可用
 */
export async function getProjects(client, options = {}) {
  const {
    page = 1, pageSize = 200, accountId = ACCOUNT_ID,
    date = localDateStr(),
  } = options;

  const body = JSON.stringify({
    st: date,
    et: date,
    sort_stat: 'stat_cost',
    project_status: [-1],       // -1 = 不限（含停投/删除）
    promotion_status: [-1],
    limit: pageSize,
    page,
    sort_order: 1,               // 1=消耗倒序（高→低）
    campaign_type: [1],          // 1=通投
    fields: [
      'stat_cost', 'show_cnt', 'convert_cnt', 'form', 'message_action',
      'clue_message_count', 'attribution_all_convert_clue_count',
      'ctr', 'cpm_platform', 'conversion_rate', 'conversion_cost',
      'luban_live_enter_cnt', 'live_watch_one_minute_count',
      'luban_live_comment_cnt', 'live_component_click_cost',
    ],
    isSophonx: 1,               // ← 关键标志：返回 metrics
    search_type: '8',
    cascade_fields: ['support_cost_rate_7d', 'budget_optimize_switch'],
    need_trans_toLocal: true,
  });

  const resp = await apiRequest(`${BASE_URL}/ad/api/promotion/projects/list?aadvid=${accountId}`, {
    method: 'POST', body, cookieData: client.cookieData,
  });

  if (!resp.ok) {
    failLogOnce('projects/list:' + resp.status, () => console.log(`  ❌ projects/list 失败 [${resp.status}]`));
    return { projects: [], totalMetrics: null, pagination: null };
  }

  const d = resp.data?.data || {};
  return {
    projects: d.projects || [],
    totalMetrics: d.total_metrics || null,
    pagination: d.pagination || null,
  };
}

/**
 * 获取账户 Dashboard 统计（消耗/预算/余额）
 */
export async function getDashboardStats(client, accountId = ACCOUNT_ID) {
  const resp = await apiRequest(`${BASE_URL}/ad/api/agw/dashboard/dashboard_stats?aadvid=${accountId}`, {
    cookieData: client.cookieData,
  });

  if (!resp.ok) {
    failLogOnce('dashboard_stats:' + resp.status, () => console.log(`  ❌ dashboard_stats 失败 [${resp.status}]`));
    return null;
  }

  const d = resp.data?.data || {};
  return {
    advertiserName: d.advertiser_name || '',
    todaySpend: parseFloat(String(d.today_cost || '0').replace(/,/g, '')),
    todayBudget: parseFloat(String(d.budget || '0').replace(/,/g, '')),
    balance: parseFloat(String(d.balance || '0').replace(/,/g, '')),
    validBalance: parseFloat(String(d.valid_balance || '0').replace(/,/g, '')),
    cash: parseFloat(String(d.cash || '0').replace(/,/g, '')),
    grant: parseFloat(String(d.grant || '0').replace(/,/g, '')),
    brandCost: parseFloat(String(d.brand_cost || '0').replace(/,/g, '')),
    bidCost: parseFloat(String(d.bid_cost || '0').replace(/,/g, '')),
    budgetMode: d.budget_mode || 0,
  };
}

/**
 * 获取小时级统计（含昨日环比）
 * @param {object} client - createClient() 返回的客户端
 * @param {object} options
 * @param {number} [options.accountId=ACCOUNT_ID]
 * @param {number} [options.startHour] - 起始小时(0-22)，不传则从0点开始
 * @param {number} [options.endHour] - 结束小时(1-23)，不传则到当前小时
 *   例: { startHour: 13, endHour: 14 } → 拉 13:00-15:00 两小时数据
 */
export async function getHourlyStats(client, options = {}) {
  const { accountId = ACCOUNT_ID, startHour, endHour } = options;
  const now = new Date();
  const todayDate = localDateStr(now);
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDate = localDateStr(yesterday);
  const hourStr = `${String(now.getHours()).padStart(2, '0')}:00:00`;

  // 支持 startHour/endHour 指定时段；endHour 为闭区间末位小时，EndTime 取 endHour+1
  const startTime = startHour != null
    ? `${todayDate} ${String(startHour).padStart(2, '0')}:00:00`
    : `${todayDate} 00:00:00`;
  const endTime = endHour != null
    ? `${todayDate} ${String(endHour + 1).padStart(2, '0')}:00:00`
    : `${todayDate} ${hourStr}`;
  // 昨日同时段对比
  const yStartTime = startHour != null
    ? `${yesterdayDate} ${String(startHour).padStart(2, '0')}:00:00`
    : `${yesterdayDate} 00:00:00`;
  const yEndTime = endHour != null
    ? `${yesterdayDate} ${String(endHour + 1).padStart(2, '0')}:00:00`
    : `${yesterdayDate} ${hourStr}`;

  const body = JSON.stringify({
    StartTime: startTime,
    EndTime: endTime,
    ComparisonParams: {
      RatioStartTime: yStartTime,
      RatioEndTime: yEndTime,
    },
    Metrics: ['stat_cost', 'form', 'show_cnt', 'cpm_platform', 'click_cnt', 'conversion_cost', 'convert_cnt'],
    DataSetKey: 'ad_promotion_basic_data',
    Filters: {
      ConditionRelationshipType: 1,
      Conditions: [
        { Field: 'advertiser_id', Operator: 7, Values: [accountId] },
      ],
    },
    Dimensions: ['stat_time_hour'],
    PageParams: { Limit: 500, Offset: 0 },
    OrderBy: [{ Field: 'stat_time_hour', Type: 1 }],
    IsDownload: false,
    Extra: { is_fill_zero: 'true' },
  });

  const resp = await apiRequest(`${BASE_URL}/ad/api/agw/statistics_sophonx/statQuery?aadvid=${accountId}`, {
    method: 'POST', body, cookieData: client.cookieData,
  });

  if (!resp.ok) {
    failLogOnce('statQuery:' + resp.status, () => console.log(`  ❌ statQuery 失败 [${resp.status}]`));
    return { rows: [], totalMetrics: null };
  }

  const rows = resp.data?.data?.StatsData?.Rows || [];
  const parsed = rows.map(row => ({
    hour: row.Dimensions?.stat_time_hour?.ValueStr || '?',
    metrics: Object.fromEntries(
      Object.entries(row.Metrics || {}).map(([k, v]) => [
        k,
        { value: v.Value, valueStr: v.ValueStr, comparison: v.Comparison?.Value, ratio: v.Comparison?.Ratio },
      ])
    ),
  }));

  return { rows: parsed };
}

// ====== 完整数据采集（替代 CDP 全流程） ======

/**
 * 完成一次完整的监控数据采集
 * 替代 oceanengine-monitor-v3 的整个 CDP 连接+导航+校准+抓取流程
 *
 * @param {object} client
 * @returns {Promise<object>} 与 v3.1 兼容的数据结构
 */
export async function collectAllData(client) {
  const start = Date.now();
  console.log('  📡 HTTP API 数据采集 (无CDP/无浏览器)...');

  // 并发请求3个API
  let [page1, stats] = await Promise.all([
    getProjects(client, { page: 1, pageSize: 100 }),
    getDashboardStats(client),
  ]);

  // Cookie 过期检测：如果 projects 返回了但 metrics 全空，强制刷新 Cookie 重试
  if (page1.projects.length > 0) {
    const hasMetrics = page1.projects.some(p => Object.keys(p.metrics || {}).length > 0);
    if (!hasMetrics) {
      console.log('  ⚠ metrics为空，Cookie可能过期，强制刷新重试...');
      await client.refreshCookies();
      [page1, stats] = await Promise.all([
        getProjects(client, { page: 1, pageSize: 100 }),
        getDashboardStats(client),
      ]);
    }
  }

  let allProjects = page1.projects;
  const pag = page1.pagination;

  // 分页抓取（每页200条，最多5页安全上限 = 1000条）
  if (pag && pag.total_page > 1) {
    console.log(`  📄 分页抓取: ${pag.total_page} 页 / ${pag.total_count} 条`);
    for (let p = 2; p <= Math.min(pag.total_page, 5); p++) {
      const next = await getProjects(client, { page: p, pageSize: 100 });
      if (next.projects.length === 0) break;

      // 检查该页是否有消耗项目
      const hasSpend = next.projects.some(pr =>
        parseFloat(String(pr.metrics?.stat_cost || '0').replace(/,/g, '')) > 0
      );
      allProjects = [...allProjects, ...next.projects];
      if (!hasSpend) {
        console.log(`  ⏹ 第${p}页无消耗，停止分页`);
        break;
      }
    }
  }

  // 标准化为与 v4 兼容的 campaigns 格式
  const campaigns = allProjects.map(p => {
    const m = p.metrics || {};
    // 状态标准化：API状态 → v4内部状态
    const apiStatus = p.project_status_name || p.project_status_first_name || '';
    let status = apiStatus;
    if (apiStatus === '启用' || apiStatus === '启用中' || apiStatus === '投放中') status = '投放中';
    else if (apiStatus === '暂停' || apiStatus === '未投放') status = '未投放(已暂停)';
    else if (apiStatus === '删除' || apiStatus === '已删除') status = '已删除';
    
    return {
      id: p.project_id || '',
      name: p.project_name || '',
      status,
      rawStatus: apiStatus,
      optStatus: p.campaign_status,
      spend: parseFloat(String(m.stat_cost || '0').replace(/,/g, '')),
      conversions: parseInt(String(m.convert_cnt || '0').replace(/,/g, '')) || 0,
      formSubmit: parseInt(String(m.form || '0').replace(/,/g, '')) || 0,
      privateMsgOpen: parseInt(String(m.message_action || '0').replace(/,/g, '')) || 0,
      privateMsgRetain: parseInt(String(m.clue_message_count || '0').replace(/,/g, '')) || 0,
      attributionClue: parseInt(String(m.attribution_all_convert_clue_count || '0').replace(/,/g, '')) || 0,
      leads: parseInt(String(m.attribution_all_convert_clue_count || '0').replace(/,/g, '')) || 0, // 归因线索=leads
      ctr: parseFloat(String(m.ctr || '0%').replace(/%/g, '')) / 100 || 0,  // API返回百分比，CDP存小数
      cpm: parseFloat(String(m.cpm_platform || '0').replace(/,/g, '')),
      cvr: parseFloat(String(m.conversion_rate || '0%').replace(/%/g, '')) / 100 || 0,
      cpa: parseFloat(String(m.conversion_cost || '0').replace(/,/g, '')),
      budget: parseFloat(String(p.campaign_budget || '0').replace(/,/g, '')),
      budgetMode: p.campaign_budget_mode_name || '',
      liveEnter: parseInt(String(m.luban_live_enter_cnt || '0').replace(/,/g, '')) || 0,
      liveViews: parseInt(String(m.luban_live_enter_cnt || '0').replace(/,/g, '')) || 0,
      liveOneMin: parseInt(String(m.live_watch_one_minute_count || '0').replace(/,/g, '')) || 0,
      liveOver1Min: parseInt(String(m.live_watch_one_minute_count || '0').replace(/,/g, '')) || 0,
      liveComment: parseInt(String(m.luban_live_comment_cnt || '0').replace(/,/g, '')) || 0,
    };
  });

  // 汇总行数据
  const tm = page1.totalMetrics || {};
  const pageSummary = tm ? {
    spend: parseFloat(String(tm.stat_cost || '0').replace(/,/g, '')),
    impressions: parseInt(String(tm.show_cnt || '0').replace(/,/g, '')) || 0,
    conversions: parseInt(String(tm.convert_cnt || '0').replace(/,/g, '')) || 0,
    formSubmit: parseInt(String(tm.form || '0').replace(/,/g, '')) || 0,
    privateMsgOpen: parseInt(String(tm.message_action || '0').replace(/,/g, '')) || 0,
    privateMsgRetain: parseInt(String(tm.clue_message_count || '0').replace(/,/g, '')) || 0,
    attributionClue: parseInt(String(tm.attribution_all_convert_clue_count || '0').replace(/,/g, '')) || 0,
    leads: parseInt(String(tm.attribution_all_convert_clue_count || '0').replace(/,/g, '')) || 0,
    ctr: parseFloat(String(tm.ctr || '0%').replace(/%/g, '')) / 100 || 0,
    cpm: parseFloat(String(tm.cpm_platform || '0').replace(/,/g, '')),
    cvr: parseFloat(String(tm.conversion_rate || '0%').replace(/%/g, '')) / 100 || 0,
    cpa: parseFloat(String(tm.conversion_cost || '0').replace(/,/g, '')),
    liveEnter: parseInt(String(tm.luban_live_enter_cnt || '0').replace(/,/g, '')) || 0,
    liveViews: parseInt(String(tm.luban_live_enter_cnt || '0').replace(/,/g, '')) || 0,
    liveOneMin: parseInt(String(tm.live_watch_one_minute_count || '0').replace(/,/g, '')) || 0,
    liveOver1Min: parseInt(String(tm.live_watch_one_minute_count || '0').replace(/,/g, '')) || 0,
    liveComment: parseInt(String(tm.luban_live_comment_cnt || '0').replace(/,/g, '')) || 0,
  } : null;

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const spendingCount = campaigns.filter(c => c.spend > 0).length;
  console.log(`  ✅ 采集完成: ${campaigns.length} 条计划 (${spendingCount}有消耗) | 总消耗 ¥${pageSummary?.spend?.toFixed(2) || '?'} | ${elapsed}s`);

  return {
    campaigns,
    accountSpend: stats?.todaySpend || pageSummary?.spend || 0,
    accountBudget: stats?.todayBudget || 0,
    accountBalance: stats?.balance || 0,
    pageSummary,
    stats,
    elapsed,
    method: 'http_api',
    totalProjects: pag?.total_count || campaigns.length,
    totalPages: pag?.total_page || 1,
  };
}

// ====== 时段统计（支持精确 startTime/endTime） ======
export async function getSessionStats(client, options = {}) {
  const { accountId = ACCOUNT_ID, startTime, endTime } = options;
  const body = JSON.stringify({
    StartTime: startTime,
    EndTime: endTime,
    Metrics: ['stat_cost', 'form', 'show_cnt', 'cpm_platform', 'click_cnt', 'conversion_cost', 'convert_cnt'],
    DataSetKey: 'ad_promotion_basic_data',
    Filters: {
      ConditionRelationshipType: 1,
      Conditions: [
        { Field: 'advertiser_id', Operator: 7, Values: [accountId] },
      ],
    },
    Dimensions: ['stat_time_hour'],
    PageParams: { Limit: 500, Offset: 0 },
    OrderBy: [{ Field: 'stat_time_hour', Type: 1 }],
    IsDownload: false,
    Extra: { is_fill_zero: 'true' },
  });

  const resp = await apiRequest(`${BASE_URL}/ad/api/agw/statistics_sophonx/statQuery?aadvid=${accountId}`, {
    method: 'POST', body, cookieData: client.cookieData,
  });

  if (!resp.ok) {
    failLogOnce('statQuery_session:' + resp.status, () => console.log(`  ❌ statQuery (session) 失败 [${resp.status}]`));
    return { total: { cost: 0, leads: 0 }, rows: [] };
  }

  const apiRows = resp.data?.data?.StatsData?.Rows || [];
  const rows = apiRows.map(row => ({
    hour: row.Dimensions?.stat_time_hour?.ValueStr || '?',
    cost: parseFloat((row.Metrics?.stat_cost?.ValueStr || '0').replace(/,/g, '')) || 0,
    leads: parseInt((row.Metrics?.convert_cnt?.ValueStr || '0').replace(/,/g, '')) || 0,
  }));

  let totalCost = 0, totalLeads = 0;
  rows.forEach(r => { totalCost += r.cost; totalLeads += r.leads; });

  return { total: { cost: totalCost, leads: totalLeads }, rows };
}

// ====== 暂停/启动项目 ======
export async function updateProjectStatus(client, options = {}) {
  const { projectId, status, accountId = ACCOUNT_ID } = options;
  // update_status API: 0=启用(resume), 1=暂停(pause)
  // 注意: 与 projects/list 返回的 project_status 字段值不同 (list中 0=启用,2=暂停)
  const statusValue = (status === 'enable' || status === 'resume' || status === 'start') ? 0 : 1;

  const body = JSON.stringify({
    status_map: { [String(projectId)]: statusValue },
    is_async: false,
  });

  const resp = await apiRequest(
    `${BASE_URL}/ad/api/promotion/projects/update_status?aadvid=${accountId}`,
    { method: 'POST', body, cookieData: client.cookieData }
  );

  // apiRequest 返回 {ok, status, data}，data 为 API 原始 JSON
  const apiCode = resp?.data?.code;
  if (apiCode === 0) {
    const innerData = resp?.data?.data || {};
    const results = innerData?.results || {};
    const result = results[String(projectId)] || {};
    return {
      ok: true,
      projectId: String(projectId),
      status: status,
      message: result.msg || '',
      data: result,
    };
  } else {
    return {
      ok: false,
      error: resp?.data?.msg || resp?.data?.message || 'unknown error',
      code: apiCode,
    };
  }
}

// ====== 调整预算 ======
export async function updateProjectBudget(client, options = {}) {
  const { projectId, budget, accountId = ACCOUNT_ID } = options;

  const body = JSON.stringify({
    budgets: {
      [String(projectId)]: {
        budget: String(parseFloat(budget).toFixed(2)),
        budget_mode: 0,
        campaign_budget_mode_name: '按日预算',
      },
    },
  });

  const resp = await apiRequest(
    `${BASE_URL}/ad/api/promotion/projects/update_budget?aadvid=${accountId}`,
    { method: 'POST', body, cookieData: client.cookieData }
  );

  const apiCode = resp?.data?.code;
  if (apiCode === 0) {
    return { ok: true, projectId: String(projectId), budget: String(budget) };
  }
  return { ok: false, error: resp?.data?.msg || 'unknown error', code: apiCode };
}

// ====== 调整出价 ======
export async function updateProjectBid(client, options = {}) {
  const { projectId, bid, accountId = ACCOUNT_ID } = options;

  const body = JSON.stringify({
    bids: {
      [String(projectId)]: String(parseFloat(bid).toFixed(2)),
    },
  });

  const resp = await apiRequest(
    `${BASE_URL}/ad/api/promotion/projects/update_bid?aadvid=${accountId}`,
    { method: 'POST', body, cookieData: client.cookieData }
  );

  const apiCode = resp?.data?.code;
  if (apiCode === 0) {
    return { ok: true, projectId: String(projectId), bid: String(bid) };
  }
  return { ok: false, error: resp?.data?.msg || 'unknown error', code: apiCode };
}

// ====== 调整账户日预算 ======
export async function updateAccountBudget(client, options = {}) {
  const { budget, accountId = ACCOUNT_ID } = options;

  const body = JSON.stringify({ budget: Number(budget) });

  const resp = await apiRequest(
    `${BASE_URL}/ad/api/account/update_budget?aadvid=${accountId}`,
    { method: 'POST', body, cookieData: client.cookieData }
  );

  const apiCode = resp?.data?.code;
  if (apiCode === 0) {
    return { ok: true, budget: Number(budget) };
  }
  return { ok: false, error: resp?.data?.msg || 'unknown error', code: apiCode };
}

// ====== 客户端工厂 ======
export async function createClient(options = {}) {
  const { forceRefresh = false, useCache = true } = options;
  let cookieData = null;

  if (!forceRefresh && useCache) {
    try {
      if (fs.existsSync(COOKIE_CACHE_FILE)) {
        const cached = JSON.parse(fs.readFileSync(COOKIE_CACHE_FILE, 'utf-8'));
        if (cached.expireAt && Date.now() < cached.expireAt) {
          console.log(`  📦 缓存 Cookie (至 ${new Date(cached.expireAt).toLocaleString()})`);
          cookieData = cached;
        }
      }
    } catch {}
  }

  if (!cookieData) cookieData = await extractCookiesFromBrowser();

  return {
    cookieData,
    refreshCookies: () => extractCookiesFromBrowser(),
    request: (url, opts) => apiRequest(url, { ...opts, cookieData }),
  };
}


// ====== 直播间实时状态 ======
export async function getOnlineRoomList(client) {
  const resp = await apiRequest(
    `${BASE_URL}/nbs/api/statistics/live_show/online_room/list?aadvid=${ACCOUNT_ID}`,
    { method: "POST", cookieData: client.cookieData }
  );
  if (!resp.ok) { failLogOnce('online_room_list:' + resp.status, () => console.log("  online room list failed [" + resp.status + "]")); return []; }
  const raw = resp.data?.data || [];
  // API camelCase -> snake_case
  return raw.map(r => ({
    room_id: String(r.roomId || ""),
    room_title: r.roomTitle || "",
    room_status: "2",
    room_start_time: r.roomStartTime ? parseInt(r.roomStartTime) * 1000 : null,
    online_user_count: 0,
    is_live: true,
  }));
}

export async function getLiveRoomStatus(client, roomId) {
  const body = JSON.stringify({
    roomIds: [String(roomId)],
    attributes: ["room_id","room_title","room_status","room_start_time","room_end_time","online_user_count"],
  });
  const resp = await apiRequest(
    `${BASE_URL}/nbs/api/statistics/live_show/online_room/attributes?aadvid=${ACCOUNT_ID}`,
    { method: "POST", body, cookieData: client.cookieData }
  );
  if (!resp.ok) { failLogOnce('room_status:' + resp.status, () => console.log("  room status failed [" + resp.status + "]")); return null; }
  const room = (resp.data?.data || [])[0];
  if (!room) return null;
  return {
    room_id: room.room_id || String(roomId),
    room_title: room.room_title || "",
    room_status: String(room.room_status || ""),
    room_start_time: room.room_start_time ? parseInt(room.room_start_time) * 1000 : null,
    room_end_time: room.room_end_time || null,
    online_user_count: parseInt(room.online_user_count) || 0,
    is_live: room.room_status === "2" || room.room_status === 2,
  };
}

export default { createClient, getProjects, getDashboardStats, getHourlyStats, getSessionStats, collectAllData, getOnlineRoomList, getLiveRoomStatus, updateProjectStatus, updateProjectBudget, updateProjectBid, updateAccountBudget };
