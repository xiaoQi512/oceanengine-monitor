// src/services/feishu-listener-run.mjs - listener 主循环运行编排
import path from 'node:path';
import { FEISHU_CHAT_ID, FEISHU_ANCHOR_CHAT_ID, PROJECT_ROOT } from '../config/index.mjs';
import { loadState, saveState } from './feishu-listener-state.mjs';
import { msgText, isBotMsg, isAtMention, parseCommand } from './feishu-listener-commands.mjs';
import { sendMsg, addReaction, fetchMessages } from './feishu-listener-messaging.mjs';
import { scanPending } from './feishu-listener-actions.mjs';
import { handleAtMention } from './feishu-listener-ai.mjs';
import { dispatch } from './feishu-listener-dispatch.mjs';

const defaultDeps = {
  loadState,
  saveState,
  fetchMessages,
  sendMsg,
  addReaction,
  scanPending,
  msgText,
  isBotMsg,
  isAtMention,
  parseCommand,
  handleAtMention,
  dispatch,
  setIntervalFn: setInterval,
};

export async function runListener({
  monitorChatId = FEISHU_CHAT_ID,
  anchorChatId = FEISHU_ANCHOR_CHAT_ID,
  stateFile = path.join(PROJECT_ROOT, 'listener-state.json'),
  stateFileAnchor = path.join(PROJECT_ROOT, 'listener-state-anchor.json'),
  deps = {},
} = {}) {
  const d = { ...defaultDeps, ...deps };
  const chatIds = [monitorChatId, anchorChatId];
  const chatNames = {};
  chatNames[monitorChatId] = 'monitor';
  chatNames[anchorChatId] = 'anchor';
  const stateDeps = { anchorChatId, stateFile, stateFileAnchor };

  if (process.env.SIMULATE_CDP === '1') console.log('[listener] SIMULATE_CDP=1 - 跳过真实 CDP 操作');
  console.log('[listener] dual-chat mon=' + monitorChatId + ' anchor=' + anchorChatId);
  const states = {};
  for (const cid of chatIds) {
    const st = d.loadState(cid, stateDeps);
    if (!st.lastMsgId) {
      const ms = await d.fetchMessages(cid, 50);
      if (ms.length > 0) {
        st.lastMsgId = ms[0].message_id;
        d.saveState(st, cid, stateDeps);
        console.log('[listener] ' + chatNames[cid] + ' skip ' + ms.length + ' msgs');
      }
    }
    states[cid] = st;
    console.log('[listener] ' + chatNames[cid] + ' lastMsgId=' + (st.lastMsgId || 'none'));
  }

  console.log('[listener] polling every 10s');
  d.setIntervalFn(() => d.scanPending(), 30000);
  d.setIntervalFn(async () => {
    for (const cid of chatIds) {
      try {
        const msgs = await d.fetchMessages(cid, 10);
        if (!msgs.length) continue;
        const st = states[cid];
        const fresh = [];
        for (const m of msgs) {
          if (m.message_id === st.lastMsgId) break;
          fresh.push(m);
        }
        if (!fresh.length) continue;
        fresh.reverse();
        for (const m of fresh) {
          const t = d.msgText(m);
          if (d.isBotMsg(m, t)) {
            st.lastMsgId = m.message_id;
            continue;
          }
          d.addReaction(m.message_id);
          const cmd = d.parseCommand(m);
          if (cmd) {
            console.log('[' + new Date().toLocaleTimeString() + '] [' + chatNames[cid] + '] ' + (m.sender && m.sender.name || '?') + ' : ' + cmd.raw);
            try {
              await d.dispatch(cmd, (m.sender && m.sender.name) || 'unknown', cid);
            } catch (e) {
              console.error('[dispatch]', e.message);
              await d.sendMsg(cid, 'Error: ' + e.message);
            }
          } else if (d.isAtMention(m, t)) {
            console.log('[' + new Date().toLocaleTimeString() + '] [' + chatNames[cid] + '] @' + (m.sender && m.sender.name || '?') + ' : ' + t.slice(0, 80));
            st.lastMsgId = m.message_id;
            d.saveState(st, cid, stateDeps);
            try {
              await d.handleAtMention(t, cid, { chatNames });
            } catch (e) {
              console.error('[at]', e.message);
            }
          }
        }
      } catch (e) {
        console.error('[poll-' + cid + ']', e.message);
      }
    }
  }, 10000);

  return { ok: true };
}
