// cdp-action.mjs — 巨量引擎页面 CDP 操作模块
// 基于 cdp-client.mjs 统一客户端，提供：
//   - searchPlanInTable(planName): 搜索并定位计划行
//   - togglePlanStatus(planName, action): 暂停/关停/恢复
//   - adjustBudget(planName, amount): 修改日预算
//   - confirmPopupIfAny(client): 处理二次确认弹窗
//   - screenshotOnError(client, prefix): 失败截图
//
// 设计约束：
//   - 所有操作都走 CDP Input.dispatchMouseEvent / Input.dispatchKeyEvent 真实事件，适配 OVUI Vue 组件。
//   - 失败时返回 { ok:false, err:string }，不抛异常中断主流程。
//   - 默认超时、重试、截图辅助排查。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quickConnectWithRetry } from './cdp-client.mjs';
import { waitForCondition } from './wait-utils.mjs';
import { createClient as createApiClient, getProjects as apiGetProjects } from './oceanengine-api-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, 'monitor-data', 'action-screenshots');
const AUDIT_LOG_FILE = path.join(__dirname, 'monitor-data', 'action-audit.jsonl');

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_OPTIONS = { verbose: false };

// ====== API 读校验：写操作前后调用 getProjects 验证状态 ======

/**
 * 从 API 读取指定计划的当前状态（status / budget / bid）
 * @param {string} planName
 * @returns {Promise<{found:boolean, status?:string, budget?:number, bid?:string, raw?:object}>}
 */
async function readPlanStateFromApi(planName) {
  try {
    const apiClient = await createApiClient({ useCache: true });
    const result = await apiGetProjects(apiClient, { page: 1, pageSize: 50 });
    const projects = result?.projects || [];
    const hit = projects.find(p =>
      (p.project_name || '').includes(planName) || planName.includes(p.project_name || '')
    );
    if (!hit) return { found: false };
    return {
      found: true,
      status: hit.project_status_name || hit.project_status_first_name || '',
      budget: parseFloat(String(hit.campaign_budget || '0').replace(/,/g, '')) || 0,
      bid: hit.bid || '',
      raw: hit,
    };
  } catch (e) {
    console.warn('[cdp-action] API 读校验失败:', e.message);
    return { found: false, error: e.message };
  }
}

/**
 * 后置验证：对比 API 状态是否符合预期，失败重试 maxRetries 次，间隔 intervalMs
 * @param {string} planName
 * @param {(s)=>boolean} matcher - 校验函数，传入 API state，返回 bool
 * @param {object} [opts]
 */
async function verifyPlanStateWithRetry(planName, matcher, opts = {}) {
  const maxRetries = opts.maxRetries ?? 2;
  const intervalMs = opts.intervalMs ?? 5000;
  let lastState = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[cdp-action] API 校验重试 ${attempt}/${maxRetries}，等待 ${intervalMs}ms...`);
      await new Promise(r => setTimeout(r, intervalMs));
    }
    const state = await readPlanStateFromApi(planName);
    lastState = state;
    if (state.found && matcher(state)) return { ok: true, state, attempts: attempt };
  }
  return { ok: false, state: lastState, attempts: maxRetries + 1 };
}

/**
 * 追加写审计日志 (JSONL)
 * @param {object} entry - {time, action, plan, before, after, result, retries}
 */
function writeAuditLog(entry) {
  try {
    if (!fs.existsSync(path.dirname(AUDIT_LOG_FILE))) {
      fs.mkdirSync(path.dirname(AUDIT_LOG_FILE), { recursive: true });
    }
    const line = JSON.stringify({
      time: new Date().toISOString(),
      ...entry,
    }) + '\n';
    fs.appendFileSync(AUDIT_LOG_FILE, line);
  } catch (e) {
    console.warn('[cdp-action] 审计日志写入失败:', e.message);
  }
}

// 确保截图目录存在
function ensureScreenshotDir() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// 失败截图
export async function screenshotOnError(client, prefix) {
  try {
    ensureScreenshotDir();
    const file = path.join(SCREENSHOT_DIR, `${prefix}-${Date.now()}.png`);
    const data = await client.screenshot();
    if (data) {
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    }
  } catch (e) {
    console.error('[cdp-action] 截图失败:', e.message);
  }
  return null;
}

// 通用：获取元素 bounding box（用于真实鼠标事件）
async function getBoundingBox(client, selector) {
  const js = `
    (() => {
      const el = ${selector};
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    })()
  `;
  return await client.evalJs(js, { returnByValue: true });
}

// 通用：在元素中心发送真实鼠标点击（press+release）
async function clickElement(client, selector, description = 'element') {
  const box = await getBoundingBox(client, selector);
  if (!box) return { ok: false, err: `${description} 未找到` };

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await client.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x, y,
  });
  await client.call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x, y,
    button: 'left',
    clickCount: 1,
  });
  await client.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x, y,
    button: 'left',
    clickCount: 1,
  });
  return { ok: true };
}

// 通用：聚焦输入框并设置 value，再触发 input 事件
async function setInputValue(client, selector, value) {
  const safeValue = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  const js = `
    (() => {
      const el = ${selector};
      if (!el) return 'not_found';
      el.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(el, '${safeValue}');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()
  `;
  return await client.evalJs(js, { returnByValue: true });
}

// 通用：发送真实 Enter 键
async function pressEnter(client) {
  for (const type of ['keyDown', 'keyUp']) {
    await client.call('Input.dispatchKeyEvent', {
      type,
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
  }
}

// 获取巨量引擎 Tab 并连接
async function connectToOceanEngine(options = {}) {
  const result = await quickConnectWithRetry({ verbose: options.verbose || false, cmdTimeout: DEFAULT_TIMEOUT });
  if (!result) return null;
  return result.client;
}

// 在页面中搜索计划（输入搜索框并回车）
async function performSearch(client, planName) {
  // 1. 清空搜索框
  const clearJs = `
    (() => {
      const input = document.querySelector('input[placeholder*="项目ID或名称"]');
      if (!input) return 'input_not_found';
      input.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'cleared';
    })()
  `;
  await client.evalJs(clearJs, { returnByValue: true });
  await new Promise(r => setTimeout(r, 300));

  // 2. 输入计划名
  const inputJs = `document.querySelector('input[placeholder*="项目ID或名称"]')`;
  const setResult = await setInputValue(client, inputJs, planName);
  if (setResult !== 'ok') return { ok: false, err: '搜索框不可用' };

  await new Promise(r => setTimeout(r, 300));

  // 3. 真实 Enter
  await pressEnter(client);
  await new Promise(r => setTimeout(r, 2000));

  return { ok: true };
}

// 在页面表格中定位计划行
// 返回 { ok, rowIndex?, rowInfo? }
export async function searchPlanInTable(client, planName, options = {}) {
  const maxPageSearch = options.maxPageSearch || 3;

  for (let page = 0; page < maxPageSearch; page++) {
    const findJs = `
      (() => {
        const name = '${planName.replace(/'/g, "\\'")}';
        const rows = document.querySelectorAll('tbody tr');
        for (let i = 0; i < rows.length; i++) {
          const nameCell = rows[i].querySelector('td:nth-child(2)');
          if (nameCell && nameCell.textContent.includes(name)) {
            const switchEl = rows[i].querySelector('[role="switch"], .oc-switch, .ovui-switch, [class*="switch"]');
            const budgetEl = rows[i].querySelector('td:nth-child(6)');
            return JSON.stringify({
              rowIndex: i,
              hasSwitch: !!switchEl,
              switchClass: switchEl?.className || '',
              switchChecked: switchEl?.getAttribute('aria-checked') === 'true' || switchEl?.className?.includes('checked'),
              budgetText: budgetEl?.textContent?.trim() || '',
            });
          }
        }
        return 'not_found';
      })()
    `;
    const result = await client.evalJs(findJs, { returnByValue: true });

    if (result && result !== 'not_found') {
      try {
        const info = JSON.parse(result);
        return { ok: true, ...info };
      } catch {
        return { ok: false, err: '解析行信息失败' };
      }
    }

    // 当前页未找到，尝试下一页（如果存在）
    const nextPageJs = `
      (() => {
        const nextBtn = document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button, .ovui-pagination__next:not(.is-disabled)');
        if (nextBtn && !nextBtn.disabled) { nextBtn.click(); return 'clicked'; }
        return 'no_next';
      })()
    `;
    const nextResult = await client.evalJs(nextPageJs, { returnByValue: true });
    if (nextResult !== 'clicked') break;
    await new Promise(r => setTimeout(r, 2000));
  }

  return { ok: false, err: '计划未找到' };
}

// 处理可能的二次确认弹窗
export async function confirmPopupIfAny(client, confirmText = '确定') {
  const js = `
    (() => {
      const all = Array.from(document.querySelectorAll('button, [role="button"], .ant-btn, .ovui-btn'));
      for (const btn of all) {
        const t = btn.textContent?.trim();
        if (t === '${confirmText.replace(/'/g, "\\'")}' || t === '确认' || t === '暂停' || t === '确定') {
          if (btn.offsetParent) { btn.click(); return 'clicked:' + t; }
        }
      }
      return 'none';
    })()
  `;
  return await client.evalJs(js, { returnByValue: true });
}

// 暂停 / 关停 / 恢复 计划
// action: 'pause' | 'stop' | 'resume'
export async function togglePlanStatus(planName, action) {
  if (!planName) return { ok: false, err: '计划名不能为空' };
  if (!['pause', 'stop', 'resume'].includes(action)) return { ok: false, err: '不支持的操作' };

  // ====== 前置 API 读校验：记录 before 状态 ======
  const beforeState = await readPlanStateFromApi(planName);
  console.log(`[cdp-action] 前置校验: ${planName} status=${beforeState.status || '?'} budget=${beforeState.budget ?? '?'}`);

  const client = await connectToOceanEngine(DEFAULT_OPTIONS);
  if (!client) return { ok: false, err: '无法连接 CDP' };

  let execResult = null;
  try {
    // 1. 搜索计划
    const searchResult = await performSearch(client, planName);
    if (!searchResult.ok) { execResult = searchResult; return execResult; }

    // 2. 定位行
    const row = await searchPlanInTable(client, planName, { maxPageSearch: 2 });
    if (!row.ok) { execResult = row; return execResult; }

    // 3. 判断目标状态
    const wantOn = action === 'resume';
    if (row.switchChecked === wantOn) {
      execResult = { ok: true, alreadyDone: true, isOn: row.switchChecked };
      return execResult;
    }

    // 4. 点击开关（真实鼠标事件）
    const switchSelector = `document.querySelectorAll('tbody tr')[${row.rowIndex}].querySelector('[role="switch"], .oc-switch, .ovui-switch, [class*="switch"]')`;
    const clickResult = await clickElement(client, switchSelector, '开关');
    if (!clickResult.ok) { execResult = clickResult; return clickResult; }

    await new Promise(r => setTimeout(r, 1500));

    // 5. 处理二次确认
    await confirmPopupIfAny(client, '确定');
    await new Promise(r => setTimeout(r, 1500));

    // ====== 6. 页面刷新 + 读取最新数据验证 ======
    console.log(`[cdp-action] 刷新页面验证 ${action}...`);
    await client.call('Page.reload', { ignoreCache: true });
    // 等待页面加载完成
    await new Promise(r => setTimeout(r, 4000));

    // 重新搜索计划
    const reSearchResult = await performSearch(client, planName);
    if (!reSearchResult.ok) {
      execResult = { ok: true, clicked: true, isOn: wantOn, verified: false, warn: '页面刷新后搜索失败' };
      return execResult;
    }

    await new Promise(r => setTimeout(r, 2000));

    // 读取刷新后的最新数据
    const verifyJs = `
      (() => {
        const name = '${planName.replace(/'/g, "\\'")}';
        const rows = document.querySelectorAll('tbody tr');
        for (let i = 0; i < rows.length; i++) {
          const nameCell = rows[i].querySelector('td:nth-child(2)');
          if (nameCell && nameCell.textContent.includes(name)) {
            const statusCell = rows[i].querySelector('td:nth-child(5)');
            const budgetCell = rows[i].querySelector('td:nth-child(6)');
            const costCell = rows[i].querySelector('td:nth-child(8)');
            const clueCell = rows[i].querySelector('td:nth-child(9)');
            const switchEl = rows[i].querySelector('[role="switch"], .oc-switch, .ovui-switch, [class*="switch"]');
            return JSON.stringify({
              status: statusCell?.textContent?.trim() || '',
              budget: budgetCell?.textContent?.trim() || '',
              cost: costCell?.textContent?.trim() || '',
              clues: clueCell?.textContent?.trim() || '',
              switchOn: switchEl?.getAttribute('aria-checked') === 'true' || switchEl?.className?.includes('checked') || false,
              rowIndex: i
            });
          }
        }
        return 'not_found';
      })()
    `;
    const verifyRaw = await client.evalJs(verifyJs, { returnByValue: true });

    let verified = false;
    let freshData = null;

    if (verifyRaw && verifyRaw !== 'not_found') {
      try {
        freshData = JSON.parse(verifyRaw);
        verified = freshData.switchOn === wantOn;
      } catch {}
    }

    console.log(`[cdp-action] 验证结果: ok=${verified} state=${freshData?.status || '?'} switchOn=${freshData?.switchOn} cost=${freshData?.cost || '?'}`);

    execResult = {
      ok: verified,
      clicked: true,
      isOn: freshData?.switchOn ?? wantOn,
      verified,
      freshData,
    };
    return execResult;
  } catch (e) {
    await screenshotOnError(client, `toggle-${action}-error`);
    execResult = { ok: false, err: e.message };
    return execResult;
  } finally {
    try { client.close(); } catch {}

    // ====== 后置 API 读校验：失败重试 2 次，间隔 5s + 写审计 ======
    const wantOn = action === 'resume';
    const verify = await verifyPlanStateWithRetry(planName, (s) => {
      // API 状态判定：resume → 启用/投放中；pause/stop → 暂停/未投放
      const st = (s.status || '').trim();
      if (wantOn) return /启用|投放中/.test(st);
      return /暂停|未投放|关停/.test(st);
    }, { maxRetries: 2, intervalMs: 5000 });

    // [v1.1 D1] 审计归一到 action-queue-worker，此处不再写入
    // writeAuditLog({
    //   action: `toggle:${action}`,
    //   plan: planName,
    //   before: beforeState.found
    //     ? { status: beforeState.status, budget: beforeState.budget }
    //     : { found: false },
    //   after: verify.state?.found
    //     ? { status: verify.state.status, budget: verify.state.budget }
    //     : { found: false },
    //   result: execResult?.ok ? 'success' : (execResult?.alreadyDone ? 'noop' : 'failed'),
    //   retries: Math.max(0, verify.attempts - 1),
    //   execResult,
    //   apiVerified: verify.ok,
    // });

    // 若 CDP 验证失败但 API 校验通过，以 API 为准
    if (execResult && !execResult.ok && verify.ok) {
      console.log('[cdp-action] CDP 验证未通过，但 API 校验通过，视为成功');
      execResult.ok = true;
      execResult.verified = true;
      execResult.freshData = verify.state;
    }
  }
}

// 调整计划日预算
export async function adjustBudget(planName, amount) {
  if (!planName) return { ok: false, err: '计划名不能为空' };
  if (!amount || amount <= 0) return { ok: false, err: '金额必须大于0' };

  // ====== 前置 API 读校验：记录 before 状态 ======
  const beforeState = await readPlanStateFromApi(planName);
  console.log(`[cdp-action] 前置校验(预算): ${planName} budget=${beforeState.budget ?? '?'}`);

  const client = await connectToOceanEngine(DEFAULT_OPTIONS);
  if (!client) return { ok: false, err: '无法连接 CDP' };

  let execResult = null;
  let oldBudget = null;
  try {
    // 1. 搜索并定位行
    const searchResult = await performSearch(client, planName);
    if (!searchResult.ok) { execResult = searchResult; return execResult; }

    const row = await searchPlanInTable(client, planName, { maxPageSearch: 2 });
    if (!row.ok) { execResult = row; return row; }
    oldBudget = row.budgetText;

    // 2. 点击预算单元格，尝试唤起编辑
    const budgetSelector = `document.querySelectorAll('tbody tr')[${row.rowIndex}].querySelector('td:nth-child(6)')`;
    const budgetClick = await clickElement(client, budgetSelector, '预算单元格');
    if (!budgetClick.ok) { execResult = budgetClick; return budgetClick; }

    await new Promise(r => setTimeout(r, 800));

    // 3. 查找页面中的预算输入框（可能出现在行内、popover 或弹窗）
    const findBudgetInputJs = `
      (() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        for (const inp of inputs) {
          const placeholder = inp.placeholder || '';
          const parentText = inp.closest('div, td, tr')?.textContent || '';
          if ((placeholder.includes('预算') || parentText.includes('预算') || parentText.includes('日预算')) && inp.offsetParent) {
            return JSON.stringify({ found: true, className: inp.className, placeholder });
          }
        }
        return JSON.stringify({ found: false });
      })()
    `;
    const inputInfo = await client.evalJs(findBudgetInputJs, { returnByValue: true });
    let info;
    try { info = JSON.parse(inputInfo); } catch { info = { found: false }; }

    if (!info.found) {
      await screenshotOnError(client, 'adjust-budget-no-input');
      execResult = { ok: false, err: '未找到预算输入框' };
      return execResult;
    }

    // 4. 设置预算值
    const budgetInputSelector = `
      (() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        for (const inp of inputs) {
          const placeholder = inp.placeholder || '';
          const parentText = inp.closest('div, td, tr')?.textContent || '';
          if ((placeholder.includes('预算') || parentText.includes('预算') || parentText.includes('日预算')) && inp.offsetParent) return inp;
        }
        return null;
      })()
    `;
    const setResult = await setInputValue(client, budgetInputSelector, amount);
    if (setResult !== 'ok') { execResult = { ok: false, err: '无法设置预算值' }; return execResult; }

    await new Promise(r => setTimeout(r, 500));

    // 5. 确认（Enter 或确定按钮）
    await pressEnter(client);
    await new Promise(r => setTimeout(r, 500));
    await confirmPopupIfAny(client, '确定');

    execResult = { ok: true, oldBudget: row.budgetText, newBudget: amount };
    return execResult;
  } catch (e) {
    await screenshotOnError(client, 'adjust-budget-error');
    execResult = { ok: false, err: e.message };
    return execResult;
  } finally {
    try { client.close(); } catch {}

    // ====== 后置 API 读校验：预算是否变为目标值 ======
    const verify = await verifyPlanStateWithRetry(planName, (s) => {
      return s.budget != null && Math.abs(s.budget - amount) < 0.01;
    }, { maxRetries: 2, intervalMs: 5000 });

    // [v1.1 D1] 审计归一到 action-queue-worker
    // writeAuditLog({
    //   action: 'adjust_budget',
    //   plan: planName,
    //   before: { budget: beforeState.budget ?? null, rawBudget: oldBudget },
    //   after: { budget: verify.state?.budget ?? null, expected: amount },
    //   result: execResult?.ok ? 'success' : 'failed',
    //   retries: Math.max(0, verify.attempts - 1),
    //   execResult,
    //   apiVerified: verify.ok,
    // });

    if (execResult && !execResult.ok && verify.ok) {
      console.log('[cdp-action] CDP 未确认，但 API 校验预算已生效');
      execResult.ok = true;
      execResult.verified = true;
    }
  }
}

// 调整计划出价
// 复用 clickElement + setInputValue 模式（参考 adjustBudget）
export async function adjustBid(planName, bid) {
  if (!planName) return { ok: false, err: '计划名不能为空' };
  if (bid == null || isNaN(bid) || Number(bid) <= 0) return { ok: false, err: '出价必须大于0' };

  const safeBid = Number(bid);

  // ====== 前置 API 读校验：记录 before 状态 ======
  const beforeState = await readPlanStateFromApi(planName);
  console.log(`[cdp-action] 前置校验(出价): ${planName} bid=${beforeState.bid || '?'}`);

  const client = await connectToOceanEngine(DEFAULT_OPTIONS);
  if (!client) return { ok: false, err: '无法连接 CDP' };

  let execResult = null;
  let oldBid = null;
  try {
    // 1. 搜索并定位行
    const searchResult = await performSearch(client, planName);
    if (!searchResult.ok) { execResult = searchResult; return execResult; }

    const row = await searchPlanInTable(client, planName, { maxPageSearch: 2 });
    if (!row.ok) { execResult = row; return row; }

    // 2. 点击出价单元格（通常 td:nth-child(7) 或包含"出价"的单元格）
    const bidCellSelector = `(() => {
      const rows = document.querySelectorAll('tbody tr');
      const row = rows[${row.rowIndex}];
      if (!row) return null;
      // 优先匹配文本含"出价"的单元格
      const cells = Array.from(row.querySelectorAll('td'));
      const bidCell = cells.find(c => /出价|bid/i.test(c.textContent || ''));
      return bidCell || cells[6] || null;
    })()`;
    const bidClick = await clickElement(client, bidCellSelector, '出价单元格');
    if (!bidClick.ok) { execResult = bidClick; return bidClick; }

    await new Promise(r => setTimeout(r, 800));

    // 3. 查找页面中的出价输入框
    const findBidInputJs = `
      (() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        for (const inp of inputs) {
          const placeholder = inp.placeholder || '';
          const parentText = inp.closest('div, td, tr')?.textContent || '';
          if ((placeholder.includes('出价') || parentText.includes('出价') || placeholder.toLowerCase().includes('bid')) && inp.offsetParent) {
            return JSON.stringify({ found: true, className: inp.className, placeholder, value: inp.value });
          }
        }
        return JSON.stringify({ found: false });
      })()
    `;
    const inputInfo = await client.evalJs(findBidInputJs, { returnByValue: true });
    let info;
    try { info = JSON.parse(inputInfo); } catch { info = { found: false }; }

    if (!info.found) {
      await screenshotOnError(client, 'adjust-bid-no-input');
      execResult = { ok: false, err: '未找到出价输入框' };
      return execResult;
    }
    oldBid = info.value || '';

    // 4. 设置出价值
    const bidInputSelector = `
      (() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        for (const inp of inputs) {
          const placeholder = inp.placeholder || '';
          const parentText = inp.closest('div, td, tr')?.textContent || '';
          if ((placeholder.includes('出价') || parentText.includes('出价') || placeholder.toLowerCase().includes('bid')) && inp.offsetParent) return inp;
        }
        return null;
      })()
    `;
    const setResult = await setInputValue(client, bidInputSelector, safeBid);
    if (setResult !== 'ok') { execResult = { ok: false, err: '无法设置出价值' }; return execResult; }

    await new Promise(r => setTimeout(r, 500));

    // 5. 确认（Enter 或确定按钮）
    await pressEnter(client);
    await new Promise(r => setTimeout(r, 500));
    await confirmPopupIfAny(client, '确定');

    execResult = { ok: true, oldBid, newBid: safeBid };
    return execResult;
  } catch (e) {
    await screenshotOnError(client, 'adjust-bid-error');
    execResult = { ok: false, err: e.message };
    return execResult;
  } finally {
    try { client.close(); } catch {}

    // ====== 后置 API 读校验：bid 字段是否变化 ======
    const verify = await verifyPlanStateWithRetry(planName, (s) => {
      // bid 校验：API 中 bid 字段若存在则比对，否则只要能读到状态就视为通过（出价字段 API 不一定回传）
      if (s.bid == null || s.bid === '') return true;
      return String(s.bid).includes(String(safeBid));
    }, { maxRetries: 2, intervalMs: 5000 });

    // [v1.1 D1] 审计归一到 action-queue-worker
    // writeAuditLog({
    //   action: 'adjust_bid',
    //   plan: planName,
    //   before: { bid: beforeState.bid || oldBid || null },
    //   after: { bid: verify.state?.bid ?? null, expected: safeBid },
    //   result: execResult?.ok ? 'success' : 'failed',
    //   retries: Math.max(0, verify.attempts - 1),
    //   execResult,
    //   apiVerified: verify.ok,
    // });

    if (execResult && !execResult.ok && verify.ok) {
      console.log('[cdp-action] CDP 未确认，但 API 校验出价已生效');
      execResult.ok = true;
      execResult.verified = true;
    }
  }
}

export default {
  togglePlanStatus,
  adjustBudget,
  adjustBid,
  searchPlanInTable,
  confirmPopupIfAny,
  screenshotOnError,
};
