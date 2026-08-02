// src/services/feishu-listener-actions.mjs - listener 命令确认与待办扫描
import { findLarkCli } from '../utils/monitor-utils.mjs';
import { pushCard } from '../feishu/guard.mjs';
import { loadPending, savePending } from './feishu-listener-state.mjs';
import { sendMsg } from './feishu-listener-messaging.mjs';

const DEFAULT_LARK_CLI = findLarkCli() || 'lark-cli';

export const ACTION_TEXT = { pause: '暂停', stop: '关停', resume: '恢复', adjust_budget: '加预算', reject: '拒绝', execute: '执行' };

export async function sendConfirmCard(
  chatId,
  action,
  count,
  lastTime,
  {
    larkCli = DEFAULT_LARK_CLI,
    pushCardFn = pushCard,
    sendMsgFn = sendMsg,
    actionText = ACTION_TEXT,
  } = {},
) {
  const typeText = actionText[action.type] || action.type;
  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '操作确认' },
      template: 'orange',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content:
            '当日已对 **' + action.planName + '** 执行过 ' + count + ' 次' + typeText + '操作\n' +
            '最近一次：' + lastTime + '\n' +
            '确认要再次执行吗？',
        },
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [
          { tag: 'plain_text', content: '回复「执行」确认 · 回复「拒绝」取消 · 3分钟后超时自动取消' },
        ],
      },
    ],
  };
  try {
    await pushCardFn(larkCli, card, chatId);
    console.log('[listener] 已发送确认卡片: ' + action.planName);
  } catch (e) {
    console.warn('[listener] 卡片发送失败，回退文本:', e.message);
    await sendMsgFn(chatId,
      '🟡 [卡片发送失败] 当日已对「' + action.planName + '」执行过 ' + count + ' 次' + typeText + '操作\n' +
      '   最近一次：' + lastTime + '\n' +
      '   确认要再次执行吗？\n' +
      '   回复"执行"确认 · 回复"拒绝"取消'
    );
  }
}

export async function scanPending({
  loadPendingFn = loadPending,
  savePendingFn = savePending,
  sendMsgFn = sendMsg,
  now = new Date(),
} = {}) {
  const data = loadPendingFn();
  if (!data.pending.length) return;
  const remaining = [];
  for (const item of data.pending) {
    if (new Date(item.expiresAt) < now) {
      await sendMsgFn(item.chatId,
        '⏰ 操作已超时取消\n' +
        '   「' + item.action.planName + '」确认超时（3分钟）\n' +
        '   如需执行请重新发送指令'
      );
    } else {
      remaining.push(item);
    }
  }
  if (remaining.length !== data.pending.length) {
    data.pending = remaining;
    savePendingFn(data);
  }
}
