// src/services/monitor-config.mjs - 15min 监控运行配置
import os from 'node:os';
import {
  findLarkCli,
  getTodayShiftWindow,
  DATA_DIR,
  REPORT_DIR,
  FEEDBACK_PORT,
  FEISHU_CHAT_ID,
  ACCOUNT_NAME,
  ACCOUNT_ID,
  CAMPAIGN_URL,
  DAILY_BUDGET,
} from '../utils/monitor-utils.mjs';

let _shiftWin = null;
function getShiftWindow() {
  if (!_shiftWin) _shiftWin = getTodayShiftWindow();
  return _shiftWin;
}

export const CONFIG = {
  accountName: ACCOUNT_NAME,
  accountId: ACCOUNT_ID,
  campaignUrl: CAMPAIGN_URL,
  dataDir: DATA_DIR,
  reportDir: REPORT_DIR,
  pageSize: 100,
  get dailyStartHour() { return getShiftWindow().startHour; },
  get dailyStartMinute() { return getShiftWindow().startMinute || 0; },
  get dailyEndHour() { return getShiftWindow().endHour; },
  get dailyEndMinute() { return getShiftWindow().endMinute || 0; },
  dailyBudget: DAILY_BUDGET,
  feedbackPort: FEEDBACK_PORT,
  thresholds: {
    speedFast: 1.5,
    speedVeryFast: 2,
    cpaRise: 1.2,
    cpaSevereRise: 1.5,
    zeroConvSpend: 50,
    zeroConvSevere: 200,
    highCPA_Multiplier: 2.5,
    highCPA_Spend: 30,
    highCPA_SevereSpend: 100,
    budgetCap: 0.8,
    budgetWarn: 0.85,
    budgetDanger: 0.92,
    pacingFastRatio: 1.5,
    pacingSevereRatio: 2,
    pacingSlowRatio: 0.6,
    pacingSlowMinProgress: 0.3,
    dropCountWarn: 3,
    dropCountSevere: 5,
    trendRampUp: 0.3,
    trendDrop: -0.3,
    trendMinDelta: 5,
    trendPrevMinSpend: 10,
    suggestExpireMs: 8 * 60 * 60 * 1000,
    snapshotMaxAge: 35,
  },
  get lanIP() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal && (net.address.startsWith('192.168.') || net.address.startsWith('10.'))) {
          return net.address;
        }
      }
    }
    return '127.0.0.1';
  },
  get feedbackBaseUrl() { return `http://${this.lanIP}:${this.feedbackPort}`; },
  feishuChatId: FEISHU_CHAT_ID,
  _larkCli: null,
  get larkCli() {
    if (!this._larkCli) this._larkCli = findLarkCli();
    return this._larkCli;
  },
  set larkCli(value) { this._larkCli = value; },
  enableHtmlReport: false,
};
