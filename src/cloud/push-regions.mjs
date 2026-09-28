// src/cloud/push-regions.mjs — 五大区直播场次快照推送 (小程序"五区直播"页数据源)
// 每 5min (PM2 */5): fetch 本地 8899 /api/ai-regions-sessions (60s 缓存+预热, 5ms)
//   → POST cloudrun /push { regions } (X-API-Key) → 云数据库 regions_live 集合
// 数据契约: { date, nowMin, updatedAt, regions: [{name,aadvid,dayBudget,budgetRaw,dayCost,dayLeads,dayCpl,sessions[],planned[],updatedAt}], errors }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../utils/monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 加载 .env (CLOUDRUN_URL / CLOUDRUN_API_KEY)
try {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}
const CLOUDRUN_URL = (process.env.CLOUDRUN_URL || '').replace(/\/+$/, '');
const CLOUDRUN_API_KEY = process.env.CLOUDRUN_API_KEY || '';
const log = (m) => console.log(`[push-regions ${new Date().toLocaleTimeString('zh-CN')}] ${m}`);

async function main() {
  if (!CLOUDRUN_URL || !CLOUDRUN_API_KEY) {
    console.error('[push-regions] 缺少 CLOUDRUN_URL / CLOUDRUN_API_KEY (.env), 跳过');
    process.exit(1);
  }
  const hour = new Date(Date.now() + 8 * 3600000).getUTCHours();
  // 23:30-6:59 非直播时段: 快照陈旧无意义, 跳过推送(云端保留最后一份供小程序展示)
  if (hour < 7 || hour >= 23) { log('非直播时段, 跳过'); return; }
  const res = await fetch('http://127.0.0.1:8899/api/ai-regions-sessions', { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`sessions API HTTP ${res.status}`);
  const regions = await res.json();
  if (!regions || !Array.isArray(regions.regions)) throw new Error('sessions API 返回异常');

  const up = await fetch(`${CLOUDRUN_URL}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': CLOUDRUN_API_KEY },
    body: JSON.stringify({ regions }),
    signal: AbortSignal.timeout(20000),
  });
  if (!up.ok) throw new Error(`push HTTP ${up.status}: ${(await up.text()).slice(0, 200)}`);
  const liveCnt = regions.regions.reduce((a, r) => a + r.sessions.filter(s => s.status === 'live').length, 0);
  log(`✅ 已推送五区快照: ${regions.regions.length} 区 / 在播 ${liveCnt} / 更新于 ${regions.updatedAt}`);
}

main().catch(e => { console.error('[push-regions] 失败:', e.message); process.exit(1); });
