// src/services/five-min-collect.mjs - 5min 数据采集编排
import {
  createClient as defaultCreateApiClient,
  getDashboardStats as defaultGetDashboardStats,
  getProjects as defaultGetProjects,
} from './api-client.mjs';
import { buildApiSnapshot as defaultBuildApiSnapshot } from '../domain/five-minute-logic.mjs';
import { cdpFallback as defaultCdpFallback } from './five-min-cdp-fallback.mjs';

export async function collectFiveMinData({ deps = {} } = {}) {
  const d = {
    createApiClient: defaultCreateApiClient,
    getDashboardStats: defaultGetDashboardStats,
    getProjects: defaultGetProjects,
    buildApiSnapshot: defaultBuildApiSnapshot,
    cdpFallback: defaultCdpFallback,
    ...deps,
  };

  let data = null;
  let lastErr = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const apiClient = await d.createApiClient({ useCache: true });
      const [stats, projectsPage] = await Promise.all([
        d.getDashboardStats(apiClient),
        d.getProjects(apiClient, { page: 1, pageSize: 100 }),
      ]);
      if (stats && stats.todaySpend > 0) {
        data = d.buildApiSnapshot(stats, projectsPage, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
        console.log(`  ✅ HTTP API: 消耗 ¥${stats.todaySpend.toFixed(0)} | 预算 ¥${stats.todayBudget} | 转化 ${data.totalConv} | 投放中 ${data.activeCount} | 有消耗 ${data.spendingCount}`);
        break;
      }
      lastErr = new Error('todaySpend=0');
    } catch (e) {
      lastErr = e;
    }
    if (attempt < 2) {
      console.log(`  ⚠ HTTP API 第${attempt}次失败: ${lastErr.message?.slice(0, 40)}，1秒后重试...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (!data) {
    console.log(`  ⚠ HTTP API 失败(重试后): ${lastErr?.message?.slice(0, 60)}，降级到 CDP`);
    data = await d.cdpFallback();
    if (!data) console.log(`  ❌ CDP 降级也未拿到数据`);
  }
  return { data };
}
