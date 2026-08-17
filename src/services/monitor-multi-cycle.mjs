// src/services/monitor-multi-cycle.mjs - 多账户实时监控编排
// 遍历 accounts.json 中的账户，为每个账户生成独立配置并运行 monitor-cycle。
// 默认仍保持单账户模式；设置 MONITOR_ALL_ACCOUNTS=1 时启用多账户。
import {
  ACCOUNTS,
  ACCOUNT_ID,
  ACCOUNT_NAME,
  FEISHU_CHAT_ID,
} from '../utils/monitor-utils.mjs';
import { CONFIG } from './monitor-config.mjs';
import { runMonitorCycle } from './monitor-cycle.mjs';

export async function runMultiAccountCycle({
  force = false,
  dryRun = false,
  accounts = ACCOUNTS,
  baseConfig = CONFIG,
} = {}) {
  const list = Array.isArray(accounts) && accounts.length > 0 ? accounts : [{
    accountId: ACCOUNT_ID,
    name: ACCOUNT_NAME,
  }];

  const results = [];
  for (const account of list) {
    const accountConfig = {
      ...baseConfig,
      accountId: account.accountId || ACCOUNT_ID,
      accountName: account.name || ACCOUNT_NAME,
      feishuChatId: FEISHU_CHAT_ID,
    };

    console.log(`\n========== [多账户] 开始监控 ${accountConfig.accountName} (${accountConfig.accountId}) ==========`);
    try {
      const r = await runMonitorCycle({
        config: accountConfig,
        force,
        dryRun,
      });
      results.push({ accountId: accountConfig.accountId, accountName: accountConfig.accountName, ok: true, result: r });
    } catch (e) {
      console.error(`[多账户] ${accountConfig.accountName} 监控失败: ${e.message}`);
      results.push({ accountId: accountConfig.accountId, accountName: accountConfig.accountName, ok: false, error: e.message });
    }
  }
  return results;
}

export default { runMultiAccountCycle };
