// data-consistency-check.mjs — 页面数据一致性校验 (v2)
// 页头总消耗 vs 汇总行消耗一致性检查
// 使用新 calibratePage 模块，避免重复完整刷新

import { sleep, waitForToolbar, waitForTableRows } from './wait-utils.mjs';
import { calibratePage } from './calibrate-page.mjs';

/**
 * 读取页头总消耗（toolbar）- 多策略回退
 * @param {object} client - CDP客户端
 * @returns {Promise<{spend: number|null, source: string}>}
 */
export async function getToolbarSpend(client) {
  const js = `
    (() => {
      let spend = null;
      let source = 'none';

      // 策略1: oc-promotion-tool-bar 组件精准提取
      const toolbar = document.querySelector('.oc-promotion-tool-bar');
      if (toolbar) {
        const kvPairs = toolbar.querySelectorAll('.oc-promotion-tool-bar-key-value');
        for (const kv of kvPairs) {
          const spans = kv.querySelectorAll('span');
          const label = spans[0]?.textContent?.trim() || '';
          const valStr = spans[3]?.textContent?.trim() || '';
          const val = parseFloat(valStr.replace(/,/g, '')) || 0;
          if (label.includes('日消耗')) { spend = val; source = 'toolbar_kv'; break; }
        }
      }

      // 策略2: 工具栏内正则匹配
      if (spend === null && toolbar) {
        const text = toolbar.textContent || '';
        const m = text.match(/日消耗[（(]元[)）]\\s*([\\d,]+\\.?\\d*)/);
        if (m) { spend = parseFloat(m[1].replace(/,/g, '')) || 0; source = 'toolbar_regex'; }
      }

      // 策略3: 找包含"日消耗"的任意元素，读相邻数值
      if (spend === null) {
        const allEls = Array.from(document.querySelectorAll('*'));
        for (const el of allEls) {
          const t = el.textContent?.trim();
          if ((t === '日消耗' || t === '消耗') && el.children?.length === 0 && el.offsetParent) {
            // 找同容器内的数值元素
            let p = el.parentElement;
            for (let depth = 0; depth < 5 && p && p !== document.body; depth++) {
              const valEls = p.querySelectorAll('[class*="value"]');
              for (const ve of valEls) {
                const v = parseFloat(ve.textContent?.trim().replace(/[^0-9.]/g, '')) || 0;
                if (v > 0) { spend = v; source = 'span_value'; break; }
              }
              if (spend !== null) break;
              p = p.parentElement;
            }
          }
          if (spend !== null) break;
        }
      }

      return { spend, source, ok: spend !== null };
    })()
  `;

  try {
    const result = await client.evalJs(js);
    if (result?.ok) return { spend: result.spend, source: result.source };
    return { spend: null, source: 'not_found' };
  } catch (e) {
    console.log('  ⚠️ getToolbarSpend 异常:', e.message);
    return { spend: null, source: 'error' };
  }
}

/**
 * 读取汇总行消耗
 * @param {object} client
 * @returns {Promise<{spend: number|null, source: string}>}
 */
export async function getSummarySpend(client) {
  const js = `
    (() => {
      const rows = document.querySelectorAll('tr.ovui-t-summary');
      if (rows.length === 0) return { ok: false, err: 'no_summary' };
      const cells = Array.from(rows[0].querySelectorAll('th, td'));
      if (cells.length <= 7) return { ok: false, err: 'too_few_cells:' + cells.length };
      const spend = parseFloat((cells[7]?.textContent?.trim() || '0').replace(/,/g, '')) || 0;
      return { ok: true, spend };
    })()
  `;

  try {
    const result = await client.evalJs(js);
    if (result?.ok) return { spend: result.spend, source: 'summary_row' };
    return { spend: null, source: result?.err || 'unknown' };
  } catch {
    return { spend: null, source: 'error' };
  }
}

/**
 * 轻量滚动验证表格数据是否有效
 * 不触发刷新，只检查当前DOM
 * @param {object} client
 * @returns {Promise<{valid: boolean, rows: number, hasSummary: boolean}>}
 */
async function quickValidate(client) {
  const result = await client.evalJs(`
    (() => {
      const rows = document.querySelectorAll('tbody tr:not(.ovui-t-summary)').length;
      const hasSummary = document.querySelectorAll('tr.ovui-t-summary').length > 0;
      const spend = (() => {
        const sum = document.querySelector('tr.ovui-t-summary');
        if (!sum) return null;
        const cells = sum.querySelectorAll('th, td');
        return cells[7]?.textContent?.trim() || null;
      })();
      return { rows, hasSummary, spend };
    })()
  `);

  return {
    valid: (result?.rows || 0) > 0 && result?.hasSummary === true,
    rows: result?.rows || 0,
    hasSummary: result?.hasSummary || false,
  };
}

/**
 * 主校验函数：页头消耗 vs 汇总行消耗一致性检查
 * 优化：先尝试轻量校准（使用calibratePage的目标步骤），只在必要时刷新页面
 * @param {object} client - CDP客户端
 * @param {number} [maxRetries=3] - 最大重试次数
 * @returns {Promise<{consistent: boolean, toolbarSpend: number|null, summarySpend: number|null, attempts: number}>}
 */
export async function ensureDataConsistency(client, maxRetries = 3) {
  console.log('  ⏳ 等待工具栏加载...');
  const toolbarReady = await waitForToolbar(client, 10000);
  if (!toolbarReady) {
    console.log('  ⚠️ 工具栏未加载，可能页面状态异常');
  }

  for (let i = 0; i < maxRetries; i++) {
    const { spend: toolbarSpend, source: tsSrc } = await getToolbarSpend(client);
    const { spend: summarySpend, source: ssSrc } = await getSummarySpend(client);

    console.log(`  🔬 数据一致性检查 #${i + 1}: 页头=¥${toolbarSpend ?? '?'}(${tsSrc}) 汇总=¥${summarySpend ?? '?'}(${ssSrc})`);

    // 两者都读不到 → 页面可能有问题
    if (toolbarSpend === null && summarySpend === null) {
      console.log('  ⚠️ 完全无法读取消耗数据，执行校准...');

      if (i < maxRetries - 1) {
        // 先尝试目标校准（不刷新）
        await calibratePage(client, { dateRetries: 2, searchRetries: 1, statusRetries: 1, sortRetries: 1 });
        // 等待数据渲染
        await sleep(3000);
        // 如果还是不行，刷新页面
        const v = await quickValidate(client);
        if (!v.valid) {
          console.log('    📄 刷新页面重试...');
          await client.evalJs('location.reload(true)');
          await sleep(5000);
          await waitForToolbar(client, 15000);
        }
      }
      continue;
    }

    // 只有一方可读 → 信任可读方，warn
    if (toolbarSpend === null) {
      console.log(`  ⚠️ 仅有汇总行消耗: ¥${summarySpend}，继续使用`);
      return { consistent: true, toolbarSpend: null, summarySpend, attempts: i + 1 };
    }
    if (summarySpend === null) {
      console.log(`  ⚠️ 仅有页头消耗: ¥${toolbarSpend}，继续使用`);
      return { consistent: true, toolbarSpend, summarySpend: null, attempts: i + 1 };
    }

    // 两者都有值 → 检查一致性 (2%容差)
    const diff = Math.abs(toolbarSpend - summarySpend);
    const ratio = diff / Math.max(toolbarSpend, 1);

    if (ratio < 0.02) {
      console.log(`  ✅ 数据一致 (误差 ${(ratio * 100).toFixed(2)}%)`);
      return { consistent: true, toolbarSpend, summarySpend, attempts: i + 1 };
    }

    // 数据不一致 → 尝试校准
    console.log(`  ⚠️ 数据不一致: 页头¥${toolbarSpend} vs 汇总¥${summarySpend} (差¥${diff.toFixed(0)}, ${(ratio * 100).toFixed(1)}%)`);

    if (i < maxRetries - 1) {
      // 执行校准（不刷新，只在最后才刷新）
      await calibratePage(client, { dateRetries: 2, searchRetries: 1, statusRetries: 1, sortRetries: 1 });
      await sleep(3000);

      // 校准后重新检查
      const { spend: ts2, source: ts2Src } = await getToolbarSpend(client);
      const { spend: ss2, source: ss2Src } = await getSummarySpend(client);

      const diff2 = Math.abs((ts2 || 0) - (ss2 || 0));
      const ratio2 = Math.max(ts2 || 0, ss2 || 0, 1) > 0 ? diff2 / Math.max(ts2 || 0, ss2 || 0, 1) : 0;

      if (ratio2 < 0.02) {
        console.log(`  ✅ 校准后数据一致`);
        return { consistent: true, toolbarSpend: ts2, summarySpend: ss2, attempts: i + 1 };
      }

      // 校准后仍不一致 → 刷新页面
      console.log('    📄 校准无效，刷新页面重试...');
      await client.evalJs('location.reload(true)');
      await sleep(5000);
      await waitForToolbar(client, 15000);
    }
  }

  // 所有重试用尽 → 使用当前数据
  const { spend: finalTS } = await getToolbarSpend(client);
  const { spend: finalSS } = await getSummarySpend(client);
  console.log(`  ❌ 数据一致性检查失败（${maxRetries}次重试），使用当前数据: 页头=¥${finalTS} 汇总=¥${finalSS}`);
  return { consistent: false, toolbarSpend: finalTS, summarySpend: finalSS, attempts: maxRetries };
}

export default {
  getToolbarSpend,
  getSummarySpend,
  ensureDataConsistency,
};
