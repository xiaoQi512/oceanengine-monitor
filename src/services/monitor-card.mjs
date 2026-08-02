// src/services/monitor-card.mjs - 15min 飞书卡片上下文编排
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  DATA_DIR,
  getLiveWindowLabel,
  loadSuggestionHistory,
  saveSuggestionHistory,
  recalcSummary,
} from '../utils/monitor-utils.mjs';
import { markIgnoredSuggestions } from './monitor-state.mjs';
import { buildCardMessage } from '../domain/card-builder.mjs';

const PM2_PREFIX = process.env.OEC_PM2_TEST === '1' ? '🧪 [PM2测试] ' : '';

function queryTopNewSpenders({ dbPath, Database: DatabaseCtor }) {
  let db = null;
  try {
    db = new DatabaseCtor(dbPath, { readonly: true });
    const times = db.prepare(`
      SELECT DISTINCT snapshot_time FROM snapshots
      WHERE source_type = '5min'
      ORDER BY snapshot_time DESC LIMIT 3
    `).all();
    if (times.length >= 2) {
      const prevTime = times[times.length - 1].snapshot_time;
      const currTime = times[0].snapshot_time;
      return db.prepare(`
        SELECT c.name,
          (curr.cost - COALESCE(prev.cost, 0)) as spendDelta,
          (curr.leads - COALESCE(prev.leads, 0)) as convDelta
        FROM snapshots curr
        LEFT JOIN snapshots prev
          ON curr.campaign_id = prev.campaign_id
          AND prev.snapshot_time = ? AND prev.source_type = '5min'
        INNER JOIN campaigns c ON curr.campaign_id = c.campaign_id
        WHERE curr.snapshot_time = ? AND curr.source_type = '5min'
        GROUP BY curr.campaign_id
        HAVING spendDelta > 0
        ORDER BY spendDelta DESC LIMIT 5
      `).all(prevTime, currTime);
    }
    return [];
  } catch (e) {
    console.warn(`[card] DB TOP5 查询失败: ${e.message}`);
    return [];
  } finally {
    if (db) {
      try { db.close(); } catch {}
    }
  }
}

export async function buildFeishuCard(analysis, options = {}) {
  const deps = {
    dbPath: path.join(DATA_DIR, 'oceanengine.db'),
    Database,
    loadSuggestionHistory,
    saveSuggestionHistory,
    recalcSummary,
    markIgnoredSuggestions,
    getLiveWindowLabel,
    buildCardMessage,
    pm2Prefix: PM2_PREFIX,
    enableHtmlReport: false,
    ...options,
  };

  const dbTop5 = queryTopNewSpenders(deps);
  const history = deps.loadSuggestionHistory();
  deps.markIgnoredSuggestions({
    loadSuggestionHistory: deps.loadSuggestionHistory,
    saveSuggestionHistory: deps.saveSuggestionHistory,
    recalcSummary: deps.recalcSummary,
  });

  return deps.buildCardMessage(analysis, {
    topNewSpenders: dbTop5.length > 0 ? dbTop5 : analysis.topNewSpenders || [],
    history,
    now: new Date().toLocaleString('zh-CN'),
    liveWin: deps.getLiveWindowLabel(),
    pm2Prefix: deps.pm2Prefix,
    enableHtmlReport: deps.enableHtmlReport,
  });
}

export function createFeishuCardBuilder(options = {}) {
  return analysis => buildFeishuCard(analysis, options);
}
