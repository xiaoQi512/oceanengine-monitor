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
  try {
    const apiClient = await d.createApiClient({ useCache: true });
    const [stats, projectsPage] = await Promise.all([
      d.getDashboardStats(apiClient),
      d.getProjects(apiClient, { page: 1, pageSize: 100 }),
    ]);
    if (stats && stats.todaySpend > 0) {
      data = d.buildApiSnapshot(stats, projectsPage, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
      console.log(`  ✅ HTTP API: 消耗 ¥${stats.todaySpend.toFixed(0)} | 预算 ¥${stats.todayBudget} | 转化 ${data.totalConv} | 投放中 ${data.activeCount} | 有消耗 ${data.spendingCount}`);
    }
  } catch (e) {
    console.log(`  ⚠ HTTP API 失败: ${e.message?.slice(0, 60)}`);
  }

  if (!data) data = await d.cdpFallback();
  return { data };
}
