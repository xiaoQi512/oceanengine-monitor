// src/services/http-routes/api-live-data.mjs - 直播状态 API 数据组装
import fs from 'node:fs';
import path from 'node:path';

export function buildShifts(dateStr, DATA_DIR) {
  try {
    const cacheFile = path.join(DATA_DIR, `shifts-${dateStr}.json`);
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (Array.isArray(cached.shifts) && cached.shifts.length > 0) {
        return cached.shifts.map(s => {
          const parts = (s.label || '').split('-');
          if (parts.length !== 2) return null;
          return { start: parts[0].trim(), end: parts[1].trim() };
        }).filter(Boolean);
      }
    }
  } catch {}
  if (dateStr >= '2026-07-08' && dateStr <= '2026-07-10') {
    return [{start:'06:30',end:'08:30'},{start:'08:30',end:'10:30'},{start:'10:30',end:'12:30'},{start:'12:30',end:'14:30'},{start:'14:30',end:'16:30'},{start:'16:30',end:'18:30'},{start:'18:30',end:'20:30'},{start:'20:30',end:'22:30'},{start:'22:30',end:'23:30'}];
  }
  return [{start:'06:30',end:'08:30'},{start:'08:30',end:'10:30'},{start:'10:30',end:'12:30'},{start:'12:30',end:'14:30'},{start:'14:30',end:'16:30'},{start:'16:30',end:'18:30'},{start:'18:30',end:'20:30'},{start:'20:30',end:'23:30'}];
}

export function buildAnchors(dateStr, DATA_DIR) {
  try {
    const cacheFile = path.join(DATA_DIR, `shifts-${dateStr}.json`);
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (Array.isArray(cached.shifts)) return cached.shifts.map(s => s.anchorName || '待定');
    }
  } catch {}
  return [];
}

export function buildLivePayload({ sessions, anchors, snap, DATA_DIR, nowIso = new Date().toISOString() }) {
  const hm = new Date(nowIso).getHours() * 60 + new Date(nowIso).getMinutes();
  let shifts = [];
  let isLive = false;
  let currentAnchor = '';
  if (sessions && anchors.length > 0) {
    shifts = sessions.map((s, i) => {
      const [sh, sm] = s.start.split(':').map(Number);
      const [eh, em] = s.end.split(':').map(Number);
      const smin = sh * 60 + sm, emin = eh * 60 + em;
      let status = 'upcoming';
      if (hm >= emin) status = 'past';
      else if (hm >= smin) { status = 'live'; isLive = true; currentAnchor = anchors[i] || ''; }
      return { start: s.start, end: s.end, anchor: anchors[i] || '待定', status };
    });
  }
  const shiftData = (snap && snap.shifts) ? snap.shifts : [];
  const pushLog = [];
  try {
    const logFile = path.join(DATA_DIR, 'push-log.json');
    if (fs.existsSync(logFile)) pushLog.push(...(JSON.parse(fs.readFileSync(logFile, 'utf-8')).entries || []).slice(-10));
  } catch {}
  const accounts = [];
  if (snap && snap.accounts) {
    for (const a of snap.accounts) accounts.push({ id: a.id || a.name, name: a.name, spend: a.spend || 0, leads: a.leads || 0, cpl: a.cpl || (a.leads > 0 ? a.spend / a.leads : 0), activeCount: a.activeCount || 0 });
  }
  const kpi = snap ? { totalSpend: snap.totalSpend || 0, liveSpend: snap.liveSpend || 0, videoSpend: snap.videoSpend || 0, totalLeads: snap.totalLeads || 0, totalConversions: snap.totalConversions || 0, avgCpl: snap.avgCpl || 0, liveCpl: snap.liveCpl || 0, videoCpl: snap.videoCpl || 0, privateMsg: snap.privateMsg || 0, dailyBudget: snap.dailyBudget || 45000, aiRegionsSpend: snap.aiRegionsSpend || 0 } : {};
  return { isLive, currentAnchor, shifts, shiftData, pushLog, accounts, kpi, updatedAt: nowIso };
}
