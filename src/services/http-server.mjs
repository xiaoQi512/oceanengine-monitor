// src/services/http-server.mjs - 本地 HTTP 服务启动入口
import http from 'node:http';
import os from 'node:os';
import {
  getLocalDate, loadSuggestionHistory, saveSuggestionHistory, recalcSummary,
  DATA_DIR, PROJECT_ROOT, FEEDBACK_PORT, ACCOUNT_NAME,
  ACCOUNT_ID,
  ACTION_AUDIT_FILE, ACTION_PENDING_FILE,
  ACTION_QUEUE_FILE,
} from '../utils/monitor-utils.mjs';
import { createHttpServerHandler } from './http-server-handler.mjs';
import {
  get5mSnapshots,
  DB_PATH,
  classifyDeliveryType,
  emptyGroupSummary,
  summarizeGroup,
  parseSnapshotTime,
  computePlanEffect,
  getSnapFileIndex,
  findSnapshotAround,
  findSnapshotAroundDB,
  computeActionEffect,
  ANOMALY_MIN_SPEND,
  ANOMALY_MAX_CPA,
  extractRules,
  getLatestSnapshot,
  getRecentAlerts,
  sanitize,
  escHtml,
} from './http-analysis.mjs';
import { withWriteLock, recordFeedback } from './http-feedback-store.mjs';

let _apiClient = null;
async function getApiClient() {
  if (!_apiClient) {
    _apiClient = await import('./api-client.mjs');
  }
  return _apiClient;
}

const server = http.createServer(createHttpServerHandler({
  FEEDBACK_PORT,
  PROJECT_ROOT,
  DATA_DIR,
  ACCOUNT_ID,
  ACCOUNT_NAME,
  getLocalDate,
  loadSuggestionHistory,
  saveSuggestionHistory,
  recalcSummary,
  ACTION_AUDIT_FILE,
  ACTION_PENDING_FILE,
  ACTION_QUEUE_FILE,
  getApiClient,
  get5mSnapshots,
  DB_PATH,
  classifyDeliveryType,
  emptyGroupSummary,
  summarizeGroup,
  parseSnapshotTime,
  computePlanEffect,
  getSnapFileIndex,
  findSnapshotAround,
  findSnapshotAroundDB,
  computeActionEffect,
  ANOMALY_MIN_SPEND,
  ANOMALY_MAX_CPA,
  extractRules,
  getLatestSnapshot,
  getRecentAlerts,
  sanitize,
  escHtml,
  withWriteLock,
  recordFeedback,
}));

export function startServer() {
  server.listen(FEEDBACK_PORT, '0.0.0.0', () => {
    const nets = os.networkInterfaces();
    let lanIP = '127.0.0.1';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal && (net.address.startsWith('192.168.') || net.address.startsWith('10.'))) {
          lanIP = net.address;
        }
      }
    }
    console.log(`📡 反馈服务器已启动: http://0.0.0.0:${FEEDBACK_PORT}`);
    console.log(`   Dashboard: http://127.0.0.1:${FEEDBACK_PORT}/dashboard`);
    console.log(`   本机报表: http://127.0.0.1:${FEEDBACK_PORT}/report`);
    console.log(`   局域网报表: http://${lanIP}:${FEEDBACK_PORT}/report`);
    console.log(`   历史: http://127.0.0.1:${FEEDBACK_PORT}/history`);
  });

  process.on('SIGTERM', () => { server.close(); process.exit(0); });
  process.on('SIGINT', () => { server.close(); process.exit(0); });
}
