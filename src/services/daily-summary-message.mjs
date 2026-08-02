// src/services/daily-summary-message.mjs - 日汇总消息构建与推送
import { execFileSync } from 'node:child_process';
import { findLarkCli, PROJECT_ROOT, FEISHU_ANCHOR_CHAT_ID as SUMMARY_CHAT_ID } from '../utils/monitor-utils.mjs';
import { log } from './daily-summary-common.mjs';

export function pushToLark(text, {
  findLarkCliFn = findLarkCli,
  chatId = SUMMARY_CHAT_ID,
  projectRoot = PROJECT_ROOT,
  execFileSyncFn = execFileSync,
  logFn = log,
} = {}) {
  const larkCli = findLarkCliFn();
  if (!larkCli) {
    logFn('  ⚠ lark-cli 不可用');
    return false;
  }
  const isExe = larkCli.endsWith('.exe');
  try {
    const out = execFileSyncFn(
      isExe ? larkCli : 'cmd.exe',
      isExe
        ? ['im', '+messages-send', '--chat-id', chatId, '--text', text, '--as', 'bot']
        : ['/c', larkCli, 'im', '+messages-send', '--chat-id', chatId, '--text', text, '--as', 'bot'],
      { encoding: 'utf-8', timeout: 20000, windowsHide: true, cwd: projectRoot }
    );
    const parsed = JSON.parse(out);
    if (parsed.ok) {
      logFn(`  ✅ 已推送飞书群: ${parsed.data?.message_id || 'ok'}`);
      return true;
    }
    logFn(`  ❌ 推送失败: ${parsed.error?.message || JSON.stringify(parsed)}`);
    return false;
  } catch (e) {
    logFn(`  ❌ 推送异常: ${e.message}`);
    return false;
  }
}

export function buildDailySummaryMessage({ live, video, anchors, sessions, todayLabel }) {
  const totalConsume = live.totalConsume + video.totalConsume;
  const totalLeads = live.totalLeads + video.totalLeads;
  const totalCpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';
  const liveCpl = live.totalLeads > 0 ? (live.totalConsume / live.totalLeads).toFixed(2) : '0.00';
  const videoCpl = video.totalLeads > 0 ? (video.totalConsume / video.totalLeads).toFixed(2) : '0.00';
  const fmt = v => Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const firstSession = sessions[0]?.start || '06:30';
  const lastSession = sessions[sessions.length - 1]?.end || '23:30';
  return [
    `【极狐区域福利营销中心】 ${todayLabel}数据汇总`,
    `${firstSession}-${lastSession} 直播时段数据`,
    `【主播】：${anchors.length > 0 ? anchors.join(' ') : '-'}`,
    '【私信人数】：-',
    '【线索数】：-',
    `【投流费用】：${fmt(totalConsume)}元（直播${fmt(live.totalConsume)}元/短视频${fmt(video.totalConsume)}元）`,
    `【线索成本（CPL）】：${totalCpl}元（直播CPL${liveCpl}/短视频CPL${videoCpl}）`,
  ].join('\n');
}
