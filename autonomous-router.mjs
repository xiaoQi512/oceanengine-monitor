// autonomous-router.mjs — 智能路由 + 熔断 + 成本 guardrail
// 职责：为每次监控/推送/采集任务选择最优 provider，并在异常时自动降级。
//
// 设计约束：
// - 每个 provider 独立维护 CircuitBreaker。
// - 每次调用有 timeout、retry cap、fallback。
// - 成本 estimate 仅在含外部模型/lark 重试时非零；本地 API/CDP 成本近似 0。

import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DATA_DIR, atomicWriteJSON } from './monitor-utils.mjs';

const TELEMETRY_FILE = path.join(DATA_DIR, 'telemetry.jsonl');

// ====== 全局默认 guardrail ======
export const DEFAULT_LIMITS = {
  maxRetries: 2,
  maxCostPerRun: 0.01,      // USD，仅外部付费场景有意义
  timeoutMs: 15000,          // API 默认 15s
  circuitFailureThreshold: 3, // 最近 failureWindow 次失败 ≥ 此值则熔断
  circuitFailureWindow: 5,
  circuitOpenDurationMs: 30_000,
};

// ====== 熔断器 ======
export class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || DEFAULT_LIMITS.circuitFailureThreshold;
    this.failureWindow = options.failureWindow || DEFAULT_LIMITS.circuitFailureWindow;
    this.openDurationMs = options.openDurationMs || DEFAULT_LIMITS.circuitOpenDurationMs;
    this.state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
    this.lastOpenTime = 0;
    this.recent = []; // { ts, success }
  }

  record(success) {
    const now = Date.now();
    this.recent.push({ ts: now, success });
    this.recent = this.recent.filter(r => now - r.ts <= 60_000); // 保留 1 分钟
    if (success) {
      if (this.state === 'HALF_OPEN') this.state = 'CLOSED';
      return;
    }
    const failures = this.recent.filter(r => !r.success).length;
    const totalInWindow = this.recent.length;
    if (totalInWindow >= this.failureWindow && failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.lastOpenTime = now;
    }
  }

  get isOpen() {
    if (this.state === 'OPEN' && Date.now() - this.lastOpenTime > this.openDurationMs) {
      this.state = 'HALF_OPEN';
    }
    return this.state !== 'CLOSED';
  }

  toJSON() {
    return {
      name: this.name,
      state: this.state,
      lastOpenTime: this.lastOpenTime,
      recentCount: this.recent.length,
    };
  }
}

// ====== Provider 包装 ======
export class Provider {
  constructor(name, executor, options = {}) {
    this.name = name;
    this.executor = executor;
    this.timeoutMs = options.timeoutMs || DEFAULT_LIMITS.timeoutMs;
    this.costPerRun = options.costPerRun || 0;
    this.circuit = new CircuitBreaker(name, {
      failureThreshold: options.failureThreshold ?? options.circuit?.failureThreshold,
      failureWindow: options.failureWindow ?? options.circuit?.failureWindow,
      openDurationMs: options.openDurationMs ?? options.circuit?.openDurationMs,
    });
    this.stats = { calls: 0, successes: 0, failures: 0, totalLatencyMs: 0 };
  }

  async execute(input) {
    if (this.circuit.isOpen) {
      throw new Error(`CIRCUIT_OPEN:${this.name}`);
    }
    const start = Date.now();
    try {
      const result = await Promise.race([
        this.executor(input),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT:${this.name}`)), this.timeoutMs)),
      ]);
      const latency = Date.now() - start;
      this.stats.calls++;
      this.stats.successes++;
      this.stats.totalLatencyMs += latency;
      this.circuit.record(true);
      return { provider: this.name, success: true, latency, result };
    } catch (e) {
      const latency = Date.now() - start;
      this.stats.calls++;
      this.stats.failures++;
      this.stats.totalLatencyMs += latency;
      this.circuit.record(false);
      throw e;
    }
  }
}

// ====== 路由评分 ======
export function scoreProvider(provider, windowRecords) {
  const records = windowRecords.filter(r => r.provider === provider.name);
  const total = records.length || 1;
  const successes = records.filter(r => r.success).length;
  const successRate = successes / total;
  const p95 = percentile(records.map(r => r.latency).sort((a, b) => a - b), 0.95) || provider.timeoutMs;
  const avgLatency = records.length ? records.reduce((s, r) => s + r.latency, 0) / records.length : 0;

  // 成本评分：假设 cheapest 为 0.0001，越贵越低
  const cheapestCost = Math.max(provider.costPerRun, 0.0001);
  const costScore = Math.min(1, 0.0001 / cheapestCost);

  // 综合评分（0-100）
  const score =
    successRate * 30 +
    Math.max(0, 25 - p95 / 2000) +
    costScore * 25 +
    Math.max(0, 20 - avgLatency / 1000);

  return {
    provider,
    score: Math.round(score * 100) / 100,
    successRate: Math.round(successRate * 100) / 100,
    p95,
    avgLatency: Math.round(avgLatency),
    costScore: Math.round(costScore * 100) / 100,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)];
}

// ====== 智能路由 ======
export class AutonomousRouter {
  constructor(providers, limits = {}) {
    this.providers = providers;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.history = [];
  }

  async route(input, options = {}) {
    const ranked = this.rankProviders();
    let lastTryError = null;

    for (const { provider, score } of ranked) {
      // rankProviders 已经过滤 OPEN，但状态可能随时变化，二次检查
      if (provider.circuit.isOpen) continue;
      if (provider.costPerRun > this.limits.maxCostPerRun) {
        this.log({ event: 'cost_skip', provider: provider.name, cost: provider.costPerRun });
        continue;
      }

      for (let attempt = 0; attempt <= this.limits.maxRetries; attempt++) {
        try {
          const execResult = await provider.execute(input);
          this.log({
            event: 'exec',
            provider: provider.name,
            score,
            ...execResult,
          });
          return execResult;
        } catch (e) {
          lastTryError = e;
          this.log({ event: 'error', provider: provider.name, attempt, error: e.message });
          if (attempt < this.limits.maxRetries) await sleep(500 * (attempt + 1));
        }
      }
    }

    throw new Error(`All providers failed. Last error: ${lastTryError?.message || 'unknown'}`);
  }

  rankProviders() {
    const records = this.getRecentRecords(20);
    return this.providers
      .filter(p => p && p.circuit && !p.circuit.isOpen)
      .map(p => ({ provider: p, ...scoreProvider(p, records) }))
      .sort((a, b) => b.score - a.score);
  }

  getRecentRecords(limit = 100) {
    if (!fs.existsSync(TELEMETRY_FILE)) return [];
    try {
      return fs.readFileSync(TELEMETRY_FILE, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  log(entry) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    try { fs.appendFileSync(TELEMETRY_FILE, line); } catch {}
  }

  snapshot() {
    return {
      providers: this.providers.map(p => ({
        name: p.name,
        stats: p.stats,
        circuit: p.circuit.toJSON(),
        costPerRun: p.costPerRun,
      })),
      rankings: this.rankProviders(),
    };
  }
}

export default { Provider, AutonomousRouter, CircuitBreaker, scoreProvider, DEFAULT_LIMITS };
