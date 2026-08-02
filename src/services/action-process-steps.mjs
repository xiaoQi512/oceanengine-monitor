// src/services/action-process-steps.mjs - action 重试步骤

export async function runHttpApiAttempts(d, head, planName, projectId) {
  let result = null;
  let attempts = 0;
  let method = 'none';
  if (projectId) {
    for (let attempt = 1; attempt <= d.apiMaxRetries; attempt++) {
      attempts = attempt;
      console.log(`[worker] HTTP API 尝试 ${attempt}/${d.apiMaxRetries}: ${head.type} "${planName}" projectId=${projectId}`);
      try {
        result = await d.tryHttpApi(head, projectId);
      } catch (e) {
        result = { ok: false, err: e.message };
      }
      if (result?.ok) {
        method = 'http_api';
        break;
      }
      if (attempt < d.apiMaxRetries) {
        console.log(`[worker] HTTP API 失败，${d.apiRetryIntervalMs}ms 后重试: ${result?.err || result?.error || '?'}`);
        await new Promise(r => setTimeout(r, d.apiRetryIntervalMs));
      }
    }
  } else {
    console.log('[worker] 无 projectId，跳过 HTTP API，直接尝试 CDP');
  }
  return { result, attempts, method };
}

export async function runCdpAttempts(d, head, planName, initialAttempts = 0) {
  let result = null;
  let attempts = initialAttempts;
  let method = 'cdp';
  console.log(`[worker] CDP 降级执行: ${head.type} "${planName}"`);
  for (let attempt = 1; attempt <= d.cdpMaxRetries; attempt++) {
    attempts++;
    console.log(`[worker] CDP 尝试 ${attempt}/${d.cdpMaxRetries}: ${head.type} "${planName}"`);
    try {
      result = await d.executeAction(head);
    } catch (e) {
      result = { ok: false, err: e.message };
    }
    if (result?.ok) {
      method = 'cdp';
      break;
    }
    if (attempt < d.cdpMaxRetries) {
      console.log(`[worker] CDP 失败，${d.cdpRetryIntervalMs}ms 后重试: ${result?.err || '?'}`);
      await new Promise(r => setTimeout(r, d.cdpRetryIntervalMs));
    }
  }
  if (!result?.ok) method = 'cdp-failed';
  return { result, attempts, method };
}
