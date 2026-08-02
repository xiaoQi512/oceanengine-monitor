// src/services/action-executor.mjs - action 执行器
import { checkCDP } from '../cdp/client.mjs';
export { reportToFeishu, readPlanAfterValue } from './action-executor-io.mjs';

let _cdpAction = null;
async function getCdpAction() {
  if (!_cdpAction) _cdpAction = await import('../cdp/action.mjs');
  return _cdpAction;
}

let _apiClient = null;
async function getApiClient() {
  if (!_apiClient) _apiClient = await import('./api-client.mjs');
  return _apiClient;
}

export async function executeAction(action, { getCdpActionFn = getCdpAction } = {}) {
  const { type, planName, amount, bid } = action;
  console.log(`[worker] CDP 执行: ${type} plan="${planName}" amount=${amount ?? '-'} bid=${bid ?? '-'}`);
  const cdp = await getCdpActionFn();
  if (type === 'pause' || type === 'stop' || type === 'resume') {
    return await cdp.togglePlanStatus(planName, type);
  }
  if (type === 'adjust_budget') {
    return await cdp.adjustBudget(planName, amount);
  }
  if (type === 'adjust_bid') {
    return await cdp.adjustBid(planName, bid);
  }
  return { ok: false, err: `未知 action 类型: ${type}` };
}

export async function tryHttpApi(head, projectId, { getApiClientFn = getApiClient } = {}) {
  const { createClient, updateProjectStatus, updateProjectBudget, updateProjectBid } = await getApiClientFn();
  const client = await createClient({ useCache: true });
  const { type, planName, amount, bid } = head;
  console.log(`[worker] HTTP API 执行: ${type} plan="${planName}" projectId=${projectId}`);
  let result = null;
  switch (type) {
    case 'pause':
    case 'stop':
      result = await updateProjectStatus(client, { projectId, status: 'pause' });
      break;
    case 'resume':
      result = await updateProjectStatus(client, { projectId, status: 'enable' });
      break;
    case 'adjust_budget':
      result = await updateProjectBudget(client, { projectId, budget: amount });
      break;
    case 'adjust_bid':
      result = await updateProjectBid(client, { projectId, bid });
      break;
    default:
      return { ok: false, err: `HTTP API 不支持的 action: ${type}` };
  }
  result.method = 'http_api';
  return result;
}

export async function isChromeHealthy({ checkCDPFn = checkCDP } = {}) {
  try {
    const status = await checkCDPFn();
    return status?.reachable === true;
  } catch (e) {
    console.warn('[worker] Chrome 健康检查失败:', e.message);
    return false;
  }
}
