// wait-utils.mjs — 智能等待工具模块
// 替代固定 sleep()，基于 DOM 轮询 + 超时 + 稳定检测
// 供所有巨量引擎脚本共用

/**
 * 基础睡眠 (唯一保留的纯时间等待，只在已知操作耗时场景使用)
 * @param {number} ms
 */
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 等待页面元素出现
 * @param {object} client - CDP客户端 (需有 evalJs 方法)
 * @param {string} selector - CSS选择器
 * @param {object} [options]
 * @param {number} [options.timeout=15000] - 超时毫秒
 * @param {number} [options.pollInterval=300] - 轮询间隔
 * @param {boolean} [options.visible=true] - 是否要求可见 (offsetParent !== null)
 * @returns {Promise<boolean>}
 */
export async function waitForElement(client, selector, options = {}) {
  const timeout = options.timeout || 15000;
  const interval = options.pollInterval || 300;
  const visible = options.visible !== false;

  const jsExpr = visible
    ? `document.querySelector('${selector.replace(/'/g, "\\'")}')?.offsetParent !== null`
    : `!!document.querySelector('${selector.replace(/'/g, "\\'")}')`;

  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await client.evalJs(jsExpr);
      if (r === true) return true;
    } catch {}
    await sleep(interval);
  }
  console.log(`  ⚠ waitForElement 超时: ${selector} (${timeout}ms)`);
  return false;
}

/**
 * 等待自定义条件为真
 * @param {object} client - CDP客户端
 * @param {string} jsExpression - 返回 true/false 的表达式
 * @param {object} [options]
 * @param {number} [options.timeout=15000]
 * @param {number} [options.pollInterval=500]
 * @param {string} [options.label] - 日志标签
 * @returns {Promise<boolean>}
 */
export async function waitForCondition(client, jsExpression, options = {}) {
  const timeout = options.timeout || 15000;
  const interval = options.pollInterval || 500;
  const label = options.label || 'condition';

  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await client.evalJs(`(() => { return !!(${jsExpression}); })()`);
      if (r === true) return true;
    } catch {}
    await sleep(interval);
  }
  console.log(`  ⚠ waitForCondition 超时: ${label} (${timeout}ms)`);
  return false;
}

/**
 * 等待表格行数达到预期
 * @param {object} client
 * @param {number} minRows - 最少行数
 * @param {object} [options]
 * @param {number} [options.timeout=30000]
 * @param {boolean} [options.skipSummary=true] - 跳过汇总行计数
 * @returns {Promise<boolean>}
 */
export async function waitForTableRows(client, minRows, options = {}) {
  const timeout = options.timeout || 30000;
  const skipSummary = options.skipSummary !== false;

  const expr = skipSummary
    ? `document.querySelectorAll('tbody tr:not(.ovui-t-summary)').length >= ${minRows}`
    : `document.querySelectorAll('tbody tr').length >= ${minRows}`;

  return waitForCondition(client, expr, {
    ...options,
    timeout,
    pollInterval: 500,
    label: `table rows >= ${minRows}`,
  });
}

/**
 * 等待值稳定（连续N次检查不变）
 * @param {object} client
 * @param {string} jsExpression - 返回值的表达式
 * @param {object} [options]
 * @param {number} [options.stableCount=3] - 连续稳定次数
 * @param {number} [options.checkInterval=500] - 检查间隔
 * @param {number} [options.timeout=15000]
 * @returns {Promise<{stable: boolean, value: any}>}
 */
export async function waitForStable(client, jsExpression, options = {}) {
  const stableCount = options.stableCount || 3;
  const interval = options.checkInterval || 500;
  const timeout = options.timeout || 15000;

  let lastValue;
  let count = 0;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const value = await client.evalJs(`(() => { return ${jsExpression}; })()`);
      if (value !== undefined && value === lastValue) {
        count++;
        if (count >= stableCount) return { stable: true, value };
      } else {
        lastValue = value;
        count = 0;
      }
    } catch {}
    await sleep(interval);
  }

  return { stable: false, value: lastValue };
}

/**
 * 等待工具栏加载完成
 * @param {object} client
 * @param {number} [timeout=10000]
 * @returns {Promise<boolean>}
 */
export async function waitForToolbar(client, timeout = 10000) {
  return waitForElement(client, '.oc-promotion-tool-bar', { timeout, pollInterval: 500 });
}

/**
 * 等待页面导航/刷新完成（执行上下文重建）
 * @param {object} client
 * @param {number} [timeout=15000]
 * @returns {Promise<boolean>}
 */
export async function waitForPageReady(client, timeout = 15000) {
  // 用 document.readyState 检查页面加载状态
  return waitForCondition(client, `document.readyState === 'complete'`, {
    timeout,
    pollInterval: 500,
    label: 'page readyState complete',
  });
}

/**
 * 等待并重试直到条件满足
 * @param {object} client
 * @param {string} jsExpression - 返回 true/false
 * @param {object} [options]
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.retryDelay=1000] - 重试前等待
 * @param {number} [options.timeout=10000] - 单次检查超时
 * @returns {Promise<{ok: boolean, attempts: number}>}
 */
export async function retryUntil(client, jsExpression, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const retryDelay = options.retryDelay || 1000;
  const timeout = options.timeout || 10000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`    🔄 重试 (${attempt + 1}/${maxRetries})...`);
      await sleep(retryDelay);
    }

    const ok = await waitForCondition(client, jsExpression, {
      timeout,
      pollInterval: 300,
      label: `retryUntil#${attempt + 1}`,
    });

    if (ok) return { ok: true, attempts: attempt + 1 };
  }

  return { ok: false, attempts: maxRetries };
}

export default {
  sleep,
  waitForElement,
  waitForCondition,
  waitForTableRows,
  waitForStable,
  waitForToolbar,
  waitForPageReady,
  retryUntil,
};
