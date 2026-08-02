// src/services/feishu-listener-commands.mjs - 命令解析兼容入口（配置注入）
import { BOT_APP_ID } from '../config/index.mjs';
import * as parser from '../domain/feishu-command-parser.mjs';

export const CMD_RULES = parser.CMD_RULES;

export function msgText(msg) {
  return parser.msgText(msg);
}

export function isBotMsg(msg, text, options = {}) {
  return parser.isBotMsg(msg, text, { botAppId: BOT_APP_ID, ...options });
}

export function isAtMention(msg, text, options = {}) {
  return parser.isAtMention(msg, text, { botAppId: BOT_APP_ID, ...options });
}

export function cleanAtText(text) {
  return parser.cleanAtText(text);
}

export function parseCommand(msg, options = {}) {
  return parser.parseCommand(msg, { botAppId: BOT_APP_ID, ...options });
}

export function extractPlanName(text, cmd, amount) {
  return parser.extractPlanName(text, cmd, amount);
}
