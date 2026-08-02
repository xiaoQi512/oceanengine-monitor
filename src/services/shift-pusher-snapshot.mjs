// src/services/shift-pusher-snapshot.mjs - 换班首场快照修正
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../utils/monitor-utils.mjs';

export function correctFirstShiftSpend({
  shift,
  totalConsume,
  totalLeads,
  cpl,
  dataDir = DATA_DIR,
  fsImpl = fs,
  pathImpl = path,
  logFn = console.log,
}) {
  try {
    const endTime = shift.label.split('-')[1];
    const [eh, em] = endTime.split(':').map(Number);
    const endMin = eh * 60 + em;
    const files = fsImpl.readdirSync(dataDir)
      .filter(f => f.startsWith('5m-') && f.endsWith('.json'))
      .sort();
    let bestFile = null;
    let bestDiff = Infinity;
    let bestHH = '';
    let bestMM = '';
    for (const f of files) {
      const m = f.match(/T(\d{2})-(\d{2})/);
      if (!m) continue;
      const fh = parseInt(m[1]);
      const fm = parseInt(m[2]);
      const fMin = fh * 60 + fm;
      const diff = Math.abs(fMin - endMin);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestFile = f;
        bestHH = m[1];
        bestMM = m[2];
      }
    }
    if (bestFile && bestDiff <= 30) {
      const snap = JSON.parse(fsImpl.readFileSync(pathImpl.join(dataDir, bestFile), 'utf-8'));
      const correctedSpend = snap.accountSpend || 0;
      if (correctedSpend > 0) {
        logFn('  🔧 首场修正(' + bestHH + ':' + bestMM + '): accountSpend ¥' + correctedSpend.toFixed(2) + ' (原API值 ¥' + totalConsume.toFixed(2) + ')');
        const correctedLeads = snap.totalConv || totalLeads;
        const nextCpl = correctedLeads > 0 ? (correctedSpend / correctedLeads).toFixed(2) : '0.00';
        return { totalConsume: correctedSpend, totalLeads: correctedLeads, cpl: nextCpl };
      }
    }
  } catch {}
  return { totalConsume, totalLeads, cpl };
}
