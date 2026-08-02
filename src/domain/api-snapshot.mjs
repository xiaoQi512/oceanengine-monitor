// src/domain/api-snapshot.mjs - 5min 快照构建与回退（纯逻辑）
import { normalizeApiProjects, isActiveStatus } from './api-normalization.mjs';

export function buildApiSnapshot(stats, projectsPage, time = new Date().toISOString().replace(/\.\d+Z$/, 'Z')) {
  const normalized = normalizeApiProjects(projectsPage);
  return {
    accountSpend: stats.todaySpend,
    accountBudget: stats.todayBudget,
    accountBalance: stats.balance,
    summarySpend: stats.todaySpend,
    totalConv: normalized.totalConv,
    activeCount: normalized.activeCnt,
    spendingCount: normalized.spendingCount,
    impressions: normalized.totalImp,
    liveViews: normalized.liveViews,
    liveOver1Min: normalized.liveOver1Min,
    allSpending: normalized.allProjects.filter(p => p.spend > 0),
    active: normalized.allProjects.filter(p => isActiveStatus(p.status)),
    campaigns: normalized.allProjects,
    summary: { totalSpend: stats.todaySpend, totalLeads: normalized.totalConv },
    sourceType: '5min',
    time,
    _method: 'http_api',
  };
}

export function correctConversionFallback(data, prevSnapshots = []) {
  if (data.totalConv || prevSnapshots.length === 0) {
    return { totalConv: data.totalConv || 0, from: null };
  }
  const lastValid = prevSnapshots.find(s => s.totalConv > 0);
  return {
    totalConv: lastValid ? lastValid.totalConv : 0,
    from: lastValid ? (data._method === 'cdp' ? 'cdp_fallback' : 'api_fallback') : null,
  };
}

export function detectCdpZeroSpend(data, prevSnapshots = []) {
  if (data._method !== 'cdp' || data.accountSpend || prevSnapshots.length === 0) {
    return { skip: false, lastValid: null };
  }
  const lastValid = prevSnapshots.find(s => s.accountSpend > 0);
  return { skip: !!lastValid, lastValid };
}

export function computeRecentCpm(data, rolling, prevSnapshots = []) {
  const baseSnap = prevSnapshots[0];
  const recentImp = baseSnap && data.impressions > baseSnap.impressions
    ? data.impressions - baseSnap.impressions
    : 0;
  return rolling.last5min > 0 && recentImp > 0 ? (rolling.last5min / recentImp * 1000) : 0;
}
