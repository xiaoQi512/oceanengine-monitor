// src/services/feishu-listener-ai-runner.mjs - AI 调用执行
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, ACCOUNT_NAME, AI_DAILY_BUDGET } from '../config/index.mjs';
import { buildAIAccountBlock, buildAICampaignBlock, buildAIPrompt } from '../domain/ai-context-prompt.mjs';

export async function callAI(
  userMessage,
  {
    getAccountContextFn,
    getCampaignListFn,
    accountName = ACCOUNT_NAME,
    aiDailyBudget = AI_DAILY_BUDGET,
    projectRoot = PROJECT_ROOT,
    spawnSyncFn = spawnSync,
    fsImpl = fs,
    pathImpl = path,
  } = {},
) {
  const ctx = await getAccountContextFn();
  const dataBlock = buildAIAccountBlock(ctx);
  const camps = await getCampaignListFn();
  const campBlock = buildAICampaignBlock(camps);
  const prompt = buildAIPrompt({ accountName, aiDailyBudget, dataBlock, campBlock, userMessage });
  const { tmpdir } = await import('node:os');
  const tmpDir = pathImpl.join(tmpdir(), 'oec-ai');
  if (!fsImpl.existsSync(tmpDir)) fsImpl.mkdirSync(tmpDir, { recursive: true });
  const txtFile = pathImpl.join(tmpDir, 'prompt.txt');
  const batFile = pathImpl.join(tmpDir, 'run.bat');
  const outFile = pathImpl.join(tmpDir, 'output.txt');
  fsImpl.writeFileSync(txtFile, prompt, 'utf-8');
  fsImpl.writeFileSync(batFile, `@echo off\r\ntype "${txtFile}" | codebuddy -p -y > "${outFile}" 2>&1\r\nexit /b 0`, 'utf-8');
  return new Promise((resolve) => {
    try {
      const result = spawnSyncFn('cmd', ['/c', batFile], { cwd: projectRoot, windowsHide: true, encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 });
      let out = '';
      try { out = fsImpl.readFileSync(outFile, 'utf-8').trim(); } catch {}
      if (result.error) console.error('[AI] spawnSync error:', result.error.message);
      if (!out) console.error('[AI] empty output, exit:', result.status, 'pid:', result.pid);
      resolve(out || null);
    } catch (e) {
      console.error('[AI] catch:', e.message);
      resolve(null);
    } finally {
      try { fsImpl.rmSync(tmpDir, { recursive: true }); } catch {}
    }
  });
}
