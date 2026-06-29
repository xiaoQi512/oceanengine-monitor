// shadow-arena.mjs — 阴影竞技场：在不污染生产的前提下测试新 provider
//
// 用法：
//   import { ShadowArena } from './shadow-arena.mjs';
//   const arena = new ShadowArena({ control: apiProvider, challenger: cdpProvider, judge });
//   arena.run(input); // 后台异步执行，不阻塞主流程

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './monitor-utils.mjs';

const SHADOW_LOG = path.join(DATA_DIR, 'shadow-log.jsonl');

// ====== 默认 judge：结构化 diff ======
export function defaultJudge(controlResult, challengerResult) {
  // 简单示例：比较 accountSpend、activeCount、campaigns 数量、字段覆盖率
  const cSpend = controlResult?.accountSpend ?? 0;
  const chSpend = challengerResult?.accountSpend ?? 0;
  const spendDiff = Math.abs(cSpend - chSpend) / Math.max(cSpend, 1);

  const cCount = (controlResult?.campaigns || []).length;
  const chCount = (challengerResult?.campaigns || []).length;
  const countDiff = Math.abs(cCount - chCount) / Math.max(cCount, 1);

  const cFields = new Set(Object.keys(controlResult?.campaigns?.[0] || {}));
  const chFields = new Set(Object.keys(challengerResult?.campaigns?.[0] || {}));
  const missingFields = [...cFields].filter(f => !chFields.has(f));
  const fieldCoverage = cFields.size ? (cFields.size - missingFields.length) / cFields.size : 0;

  // 评分：越接近 control 越高
  const accuracy = Math.max(0, 1 - spendDiff) * 0.4 + Math.max(0, 1 - countDiff) * 0.3 + fieldCoverage * 0.3;

  return {
    score: Math.round(accuracy * 100),
    spendDiff: Math.round(spendDiff * 1000) / 10,
    countDiff: Math.round(countDiff * 1000) / 10,
    fieldCoverage: Math.round(fieldCoverage * 1000) / 10,
    missingFields,
    recommendation: accuracy > 0.95 ? 'promote' : accuracy > 0.85 ? 'keep_testing' : 'reject',
  };
}

// ====== 阴影竞技场 ======
export class ShadowArena {
  constructor(options) {
    this.control = options.control;
    this.challenger = options.challenger;
    this.judge = options.judge || defaultJudge;
    this.sampleRate = options.sampleRate ?? 0.05; // 默认 5%
    this.minIntervalMs = options.minIntervalMs ?? 60_000; // 两次 shadow 执行至少间隔 1min
    this.lastRun = 0;
  }

  shouldSample() {
    if (Date.now() - this.lastRun < this.minIntervalMs) return false;
    return Math.random() < this.sampleRate;
  }

  async run(input) {
    if (!this.shouldSample()) return null;
    this.lastRun = Date.now();

    let controlResult = null;
    let challengerResult = null;
    let controlError = null;
    let challengerError = null;

    // 并行后台执行，互不阻塞，且对主流程无影响
    const [controlRes, challengerRes] = await Promise.allSettled([
      this.control.execute(input).catch(e => { controlError = e.message; return null; }),
      this.challenger.execute(input).catch(e => { challengerError = e.message; return null; }),
    ]);

    controlResult = controlRes.status === 'fulfilled' ? controlRes.value?.result : null;
    challengerResult = challengerRes.status === 'fulfilled' ? challengerRes.value?.result : null;

    let judgment = null;
    if (controlResult && challengerResult) {
      judgment = this.judge(controlResult, challengerResult);
    }

    const record = {
      ts: new Date().toISOString(),
      controlProvider: this.control.name,
      challengerProvider: this.challenger.name,
      controlLatency: controlRes.value?.latency ?? null,
      challengerLatency: challengerRes.value?.latency ?? null,
      controlError,
      challengerError,
      judgment,
    };

    this.log(record);
    return record;
  }

  log(entry) {
    const line = JSON.stringify(entry) + '\n';
    try { fs.appendFileSync(SHADOW_LOG, line); } catch {}
  }

  summary(limit = 100) {
    if (!fs.existsSync(SHADOW_LOG)) return { total: 0, wins: 0, losses: 0, pending: 0 };
    const lines = fs.readFileSync(SHADOW_LOG, 'utf-8').split('\n').filter(Boolean).slice(-limit);
    const records = lines.map(l => JSON.parse(l));
    const withJudgment = records.filter(r => r.judgment);
    return {
      total: records.length,
      promote: withJudgment.filter(r => r.judgment.recommendation === 'promote').length,
      keepTesting: withJudgment.filter(r => r.judgment.recommendation === 'keep_testing').length,
      reject: withJudgment.filter(r => r.judgment.recommendation === 'reject').length,
      avgScore: withJudgment.length
        ? withJudgment.reduce((s, r) => s + r.judgment.score, 0) / withJudgment.length
        : 0,
    };
  }
}

export default { ShadowArena, defaultJudge };
