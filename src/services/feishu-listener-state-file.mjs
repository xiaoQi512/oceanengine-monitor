// src/services/feishu-listener-state-file.mjs - listener 消息状态文件
import fs from 'node:fs';

export function getStateFile(chatId, { anchorChatId, stateFile, anchorStateFile, stateFileAnchor }) {
  return chatId === anchorChatId ? (anchorStateFile || stateFileAnchor) : stateFile;
}

export function loadState(
  chatId,
  { anchorChatId, stateFile, anchorStateFile, stateFileAnchor, readFileSync = fs.readFileSync } = {},
) {
  try {
    return JSON.parse(readFileSync(getStateFile(chatId, { anchorChatId, stateFile, anchorStateFile, stateFileAnchor }), 'utf8'));
  } catch {
    return { lastMsgId: null };
  }
}

export function saveState(
  st,
  chatId,
  { anchorChatId, stateFile, anchorStateFile, stateFileAnchor, writeFileSync = fs.writeFileSync } = {},
) {
  writeFileSync(getStateFile(chatId, { anchorChatId, stateFile, anchorStateFile, stateFileAnchor }), JSON.stringify(st, null, 2));
}
