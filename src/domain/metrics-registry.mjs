// src/domain/metrics-registry.mjs - 指标注册表加载与校验（纯逻辑）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_FILE = path.join(__dirname, 'metrics-registry.json');

const REQUIRED_FIELDS = [
  'id',
  'name',
  'aliases',
  'definition',
  'formula',
  'unit',
  'source',
  'accountScope',
  'businessScope',
  'granularity',
  'attributionWindow',
  'status',
];

export function loadMetricsRegistry({ registryFile = REGISTRY_FILE, fsImpl = fs } = {}) {
  try {
    const raw = fsImpl.readFileSync(registryFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.metrics)) {
      throw new Error('metrics-registry.json 缺少 metrics 数组');
    }
    return parsed;
  } catch (e) {
    throw new Error(`指标注册表加载失败: ${e.message}`);
  }
}

export function validateMetricsRegistry(registry) {
  const errors = [];
  const ids = new Set();
  const aliases = new Set();
  for (const m of registry.metrics || []) {
    if (!m || typeof m !== 'object') {
      errors.push('存在非对象指标项');
      continue;
    }
    for (const field of REQUIRED_FIELDS) {
      if (m[field] == null || m[field] === '') {
        errors.push(`指标 ${m.id || '(无id)'} 缺少字段 ${field}`);
      }
    }
    if (!m.id) continue;
    if (ids.has(m.id)) errors.push(`重复指标 id: ${m.id}`);
    ids.add(m.id);
    for (const alias of m.aliases || []) {
      if (aliases.has(alias)) errors.push(`重复指标别名: ${alias}`);
      aliases.add(alias);
    }
    if (!['main_live', 'ai_region', 'all'].includes(m.accountScope)) {
      errors.push(`指标 ${m.id} accountScope 非法: ${m.accountScope}`);
    }
    if (!['all', 'live', 'short_video'].includes(m.businessScope)) {
      errors.push(`指标 ${m.id} businessScope 非法: ${m.businessScope}`);
    }
    if (!['active', 'deprecated', 'draft'].includes(m.status)) {
      errors.push(`指标 ${m.id} status 非法: ${m.status}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function getMetric(registry, key) {
  if (!registry?.metrics) return null;
  const id = String(key || '').toLowerCase();
  return registry.metrics.find(m =>
    m.id.toLowerCase() === id
    || (m.aliases || []).some(a => String(a).toLowerCase() === id)
  ) || null;
}

export function getMetricsByScope(registry, { accountScope, businessScope } = {}) {
  if (!registry?.metrics) return [];
  return registry.metrics.filter(m =>
    (!accountScope || m.accountScope === accountScope || m.accountScope === 'all')
    && (!businessScope || m.businessScope === businessScope || m.businessScope === 'all')
  );
}

export function listMetrics(registry) {
  return (registry?.metrics || []).map(m => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    accountScope: m.accountScope,
    businessScope: m.businessScope,
    status: m.status,
  }));
}

export default {
  loadMetricsRegistry,
  validateMetricsRegistry,
  getMetric,
  getMetricsByScope,
  listMetrics,
};
