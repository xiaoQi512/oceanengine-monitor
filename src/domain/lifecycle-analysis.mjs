// src/domain/lifecycle-analysis.mjs - 计划生命周期推断（纯逻辑）

export function computeLifecycleFromSnapshots(active, todaySnapshots, prev15Snapshot, now = Date.now()) {
  const firstSeenMap = new Map();
  const prevDeadIds = new Set();

  if (prev15Snapshot) {
    const prevActive = prev15Snapshot.active || prev15Snapshot.allSpending || [];
    for (const pc of prevActive) {
      if (pc._lifecycle === 'dead') prevDeadIds.add(pc.id);
    }
  }

  for (const snap of todaySnapshots) {
    const campaigns = snap.active || snap.allSpending || [];
    if (campaigns.length === 0) continue;

    const snapTime = new Date(snap.time || snap._time || 0);
    if (snapTime.getTime() < now - 6 * 3600_000) continue;
    for (const c of campaigns) {
      if (!c.id || c.id === 'unknown') continue;
      if (!firstSeenMap.has(c.id)) {
        firstSeenMap.set(c.id, { firstTime: snapTime.getTime(), firstSpend: c.spend || 0 });
      }
    }
  }

  const lifecycleSummary = { cold_start: 0, active: 0, declining: 0, dead: 0 };
  for (const c of active) {
    const fs = firstSeenMap.get(c.id);
    if (!fs) {
      c._lifecycle = 'active';
      c._justRevived = false;
      lifecycleSummary.active++;
      continue;
    }

    const msActive = now - fs.firstTime;
    const hoursActive = msActive / 3600000;
    const hourlySpend = hoursActive > 0 ? c.spend / hoursActive : 0;
    const wasDead = prevDeadIds.has(c.id);

    if (hoursActive >= 3 && hourlySpend < 100) {
      c._lifecycle = 'dead';
      c._justRevived = false;
      lifecycleSummary.dead++;
    } else if (wasDead && hourlySpend >= 100) {
      c._lifecycle = 'active';
      c._justRevived = true;
      lifecycleSummary.active++;
    } else {
      c._lifecycle = 'active';
      c._justRevived = false;
      lifecycleSummary.active++;
    }
  }

  return lifecycleSummary;
}
