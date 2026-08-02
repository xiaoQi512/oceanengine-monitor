// src/services/feishu-listener-ai.mjs - listener 账户上下文与 AI 对话
import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR,
  ACCOUNT_ID,
} from '../config/index.mjs';
import { cleanAtText } from './feishu-listener-commands.mjs';
import { sendMsg } from './feishu-listener-messaging.mjs';
import { buildAccountContextFromSnapshot, buildAIFallbackMessage } from '../domain/ai-context-prompt.mjs';
import { callAI as runCallAI } from './feishu-listener-ai-runner.mjs';

let campaignCache = null;

async function defaultCreateClient() {
  const { createClient } = await import('./api-client.mjs');
  return createClient;
}

export async function getAccountContext({ dataDir = DATA_DIR, fsImpl = fs, pathImpl = path } = {}) {
  try {
    const files = fsImpl.readdirSync(dataDir).filter(f => f.startsWith('5m-') && f.endsWith('.json')).sort().reverse();
    if (!files.length) return null;
    const latest = JSON.parse(fsImpl.readFileSync(pathImpl.join(dataDir, files[0]), 'utf-8'));
    return buildAccountContextFromSnapshot(latest);
  } catch {
    return null;
  }
}

export async function getCampaignList({
  accountId = ACCOUNT_ID,
  createClient = defaultCreateClient,
  now = Date.now(),
} = {}) {
  if (campaignCache && (now - campaignCache.time) < 300000) return campaignCache.data;
  try {
    const client = await createClient({ useCache: true });
    const resp = await client.request(
      `https://ad.oceanengine.com/ad/api/promotion/projects/list?aadvid=${accountId}`,
      { method: 'POST', body: JSON.stringify({ limit: 50, page: 1, project_status: [-1], isSophonx: 1, need_trans_toLocal: true }) }
    );
    const projects = resp?.data?.data?.projects || [];
    const list = projects.map(p => ({
      name: p.project_name || '',
      status: p.project_status_name || '',
      budget: p.campaign_budget || 0,
      bid: p.project_deep_cpa_bid || 0,
    }));
    campaignCache = { time: now, data: list };
    return list;
  } catch (e) {
    console.error('[campaign]', e.message);
    return campaignCache?.data || [];
  }
}

export function callAI(userMessage, options = {}) {
  return runCallAI(userMessage, {
    getAccountContextFn: getAccountContext,
    getCampaignListFn: getCampaignList,
    ...options,
  });
}

export async function handleAtMention(
  text,
  chatId,
  {
    chatNames = {},
    cleanAtTextFn = cleanAtText,
    callAIFn = callAI,
    sendMsgFn = sendMsg,
  } = {},
) {
  const cleaned = cleanAtTextFn(text);
  console.log('[listener] @ in ' + (chatNames[chatId] || chatId) + ': ' + cleaned);
  if (!cleaned) {
    await sendMsgFn(chatId,
      '我在。\n\n' +
      '可查询数据: @小七 今天消耗多少 / 当前告警 / 余额\n' +
      '可执行操作: 暂停/关停/恢复/加预算 「计划名」\n' +
      '查看帮助: 状态 / 帮助');
    return;
  }
  const reply = await callAIFn(cleaned);
  if (reply) {
    await sendMsgFn(chatId, reply);
  } else {
    await sendMsgFn(chatId, buildAIFallbackMessage());
  }
}
