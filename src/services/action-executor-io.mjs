// src/services/action-executor-io.mjs - action 飞书反馈与状态回读
import { pushText } from '../feishu/guard.mjs';
import { findLarkCli, ACCOUNT_ID } from '../utils/monitor-utils.mjs';

let _apiClient = null;
async function getApiClient() {
  if (!_apiClient) _apiClient = await import('./api-client.mjs');
  return _apiClient;
}

export async function reportToFeishu(
  action,
  result,
  planName,
  {
    findLarkCliFn = findLarkCli,
    pushTextFn = pushText,
  } = {},
) {
  try {
    const larkCli = findLarkCliFn();
    if (!larkCli) {
      console.warn('[worker] 未找到 lark-cli，跳过飞书反馈');
      return;
    }
    const actionText = { pause: '暂停', stop: '关停', resume: '恢复', adjust_budget: '加预算', adjust_bid: '改出价' }[action.type] || action.type;
    let msg;
    if (result?.ok) {
      const extra = result.alreadyDone ? '（已是目标状态）' : '';
      msg = `✅ ${actionText}「${planName}」完成${extra}\n来源: ${action.source || '手动'}`;
    } else {
      msg = `❌ ${actionText}「${planName}」失败\n原因: ${result?.err || '未知'}\n来源: ${action.source || '手动'}`;
    }
    await pushTextFn(larkCli, msg);
    console.log(`[worker] 飞书反馈已发送: ${result?.ok ? '成功' : '失败'}`);
  } catch (e) {
    console.warn('[worker] 飞书反馈异常:', e.message);
  }
}

export async function readPlanAfterValue(
  planName,
  timeoutMs = 10000,
  { getApiClientFn = getApiClient, accountId = ACCOUNT_ID } = {},
) {
  try {
    const { createClient } = await getApiClientFn();
    const client = await createClient({ useCache: true });
    const result = await Promise.race([
      client.request(
        'https://ad.oceanengine.com/ad/api/promotion/projects/list?aadvid=' + accountId,
        { method: 'POST', body: JSON.stringify({ limit: 50, page: 1, project_status: [-1], isSophonx: 1, need_trans_toLocal: true }) }
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('readPlanAfterValue timeout')), timeoutMs)),
    ]);
    const projects = result?.data?.data?.projects || [];
    const target = projects.find(c => c.project_name?.includes(planName));
    if (!target) return null;
    return {
      status: target.project_status_name || '',
      budget: target.campaign_budget ?? null,
      bid: target.project_deep_cpa_bid ?? null,
      projectId: target.project_id || '',
    };
  } catch (e) {
    console.warn('[worker] 计划状态回读失败:', e.message);
    return null;
  }
}
