// src/services/shift-pusher-message.mjs - 换班推送消息构建

export function buildShiftPushMessage({
  todayLabel,
  shiftLabel,
  anchorName,
  totalConsume,
  totalLeads,
  cpl,
  carModel,
}) {
  return todayLabel + ' ' + shiftLabel + '\n主播：' + anchorName + '（车型：' + carModel + '）\n真人直播消耗：' + totalConsume.toFixed(2) + '\n直播广告线索数：' + totalLeads + '\n直播CPL：' + cpl;
}
