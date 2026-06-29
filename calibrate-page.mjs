// calibrate-page.mjs — 鲁棒页面校准模块 (v2)
// 每步操作后验证，失败自动重试，状态不可恢复时优雅降级
// 日期→今天 / 清空搜索 / 状态→不限 / 消耗降序 / 分页设置
// 用法: import { calibratePage, CalibrationResult } from './calibrate-page.mjs'

import { sleep, waitForElement, waitForCondition, retryUntil } from './wait-utils.mjs';

// ====== 校准步骤枚举 ======
export const Step = {
  DATE: 'date',
  SEARCH: 'search',
  STATUS: 'status',
  SORT: 'sort',
  READY: 'table_ready',
};

/**
 * @typedef {object} StepResult
 * @property {string} step - 步骤名
 * @property {boolean} ok - 是否成功
 * @property {number} attempts - 尝试次数
 * @property {string} detail - 详细信息
 */

/**
 * @typedef {object} CalibrationResult
 * @property {boolean} allOk - 所有步骤是否成功
 * @property {StepResult[]} steps - 各步骤结果
 * @property {number} totalTime - 总耗时(ms)
 */

// ====== 步骤1: 日期切换到今天 ======
async function calibrateDate(client, maxRetries = 3) {
  const detail = [];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`    🔄 日期校准重试 (${attempt + 1}/${maxRetries})...`);
      await sleep(1000);
    }

    try {
      // 1a. 点击日期输入框打开 picker
      const openResult = await client.evalJs(`
        (() => {
          // 策略1: ant-picker-input
          const inputs = Array.from(document.querySelectorAll('.ant-picker-input input'));
          const inp = inputs.find(i => i.offsetParent !== null);
          if (inp) { inp.click(); return 'picker_input'; }

          // 策略2: 找显示日期的按钮/span
          const allText = Array.from(document.querySelectorAll('button, span, [role="button"]'));
          for (const el of allText) {
            const t = el.textContent?.trim();
            if (t && /\\d{4}-\\d{2}-\\d{2}/.test(t) && el.offsetParent) {
              el.click();
              return 'date_text_clicked';
            }
          }

          // 策略3: 任何包含"日期"的元素
          const dateLabels = Array.from(document.querySelectorAll('*'));
          for (const el of dateLabels) {
            const t = el.textContent?.trim();
            if ((t === '日期' || t.includes('日期范围')) && el.children?.length <= 1 && el.offsetParent) {
              el.click();
              return 'date_label_clicked';
            }
          }

          return 'no_date_trigger';
        })()
      `);
      detail.push(`open=${openResult}`);

      await sleep(1200);

      // 1b. 在 dropdown 中找"今天"按钮
      const todayResult = await client.evalJs(`
        (() => {
          // 在 date-picker dropdown 里搜索
          const dropdowns = document.querySelectorAll(
            '.ant-picker-dropdown, .ant-picker-panel-container, [class*="picker"][class*="dropdown"], [class*="calendar"], [class*="date-panel"]'
          );
          let searchRoot = document;
          for (const dd of dropdowns) {
            if (dd.offsetWidth > 0) { searchRoot = dd; break; }
          }

          // 找文字为"今天"的叶子节点
          const allEls = Array.from(searchRoot.querySelectorAll('*'));
          for (const el of allEls) {
            const t = el.textContent?.trim();
            const childCount = el.children?.length || 0;
            if ((t === '今天' || t === 'Today') && childCount <= 1 && el.offsetParent) {
              el.click();
              return 'clicked_today';
            }
          }

          // 策略2: 找日期面板上的当前日期
          for (const el of allEls) {
            if (el.classList?.contains('ant-picker-cell-today') || el.classList?.contains('today')) {
              el.click();
              return 'clicked_today_cell';
            }
          }

          return 'today_not_found';
        })()
      `);
      detail.push(`today=${todayResult}`);

      if (todayResult === 'today_not_found') {
        // 可能是picker没打开，尝试直接关闭其他picker
        await client.evalJs(`document.body.click()`);
        await sleep(500);
        continue; // 重试
      }

      await sleep(2500); // 等待日期切换后数据刷新

      // 1c. 验证：检查汇总行有数据
      const verify = await client.evalJs(`
        (() => {
          const rows = document.querySelectorAll('tr.ovui-t-summary');
          if (rows.length === 0) return 'no_summary';
          const cells = rows[0].querySelectorAll('th, td');
          if (cells.length <= 7) return 'too_few_cells';
          const spendVal = cells[7]?.textContent?.trim() || '';
          return spendVal ? 'spend=' + spendVal : 'empty_spend';
        })()
      `);
      detail.push(`verify=${verify}`);

      if (verify.startsWith('spend=')) {
        console.log(`    ✅ 日期校准成功 (${verify})`);
        return { ok: true, attempts: attempt + 1, detail: detail.join(' | ') };
      }

      if (verify === 'no_summary') {
        console.log(`    ⚠ 日期校准: 汇总行不存在，可能页面未完全加载`);
      }

    } catch (e) {
      detail.push(`error=${e.message.slice(0, 50)}`);
    }
  }

  return { ok: false, attempts: maxRetries, detail: detail.join(' | ') };
}

// ====== 步骤2: 清空搜索框 ======
async function calibrateSearch(client, maxRetries = 3) {
  const detail = [];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await client.evalJs(`
        (() => {
          let cleared = 0;

          // 策略1: 具体placeholder
          const searchInputs = document.querySelectorAll(
            'input[placeholder*="项目ID或名称"], input[placeholder*="搜索"], input[placeholder*="计划名称"], input[placeholder*="ID"]'
          );
          for (const inp of searchInputs) {
            if (inp.value) {
              // 用原生 setter 改值，确保 Vue 响应
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
              ).set;
              nativeInputValueSetter.call(inp, '');
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              cleared++;
            }
          }

          // 策略2: 全量扫描所有输入框
          if (cleared === 0) {
            const allInputs = document.querySelectorAll('input[type="text"]:not([readonly])');
            for (const inp of allInputs) {
              if (inp.value && inp.offsetParent && !inp.closest('.ant-picker')) {
                inp.value = '';
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                cleared++;
              }
            }
          }

          return { cleared };
        })()
      `);

      const cleared = result?.cleared || 0;
      detail.push(`cleared=${cleared}`);

      await sleep(1500);

      // 验证: 检查搜索框是否真的为空
      const verify = await client.evalJs(`
        (() => {
          const inputs = document.querySelectorAll('input[placeholder*="项目ID或名称"], input[placeholder*="搜索"]');
          for (const inp of inputs) {
            if (inp.value) return 'still_has_' + inp.value.substring(0, 20);
          }
          return 'all_clear';
        })()
      `);

      if (verify === 'all_clear') {
        console.log('    ✅ 搜索框已清空');
        return { ok: true, attempts: attempt + 1, detail: detail.join(' | ') };
      }

      console.log(`    ⚠ 搜索框未完全清空: ${verify}`);

    } catch (e) {
      detail.push(`error=${e.message.slice(0, 50)}`);
    }
  }

  // 搜索框不清空不致命，降级继续
  return { ok: false, attempts: maxRetries, detail: detail.join(' | ') };
}

// ====== 步骤3: 项目状态设为"不限（包含已删除）" ======
async function calibrateStatus(client, maxRetries = 3) {
  const detail = [];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`    🔄 状态校准重试 (${attempt + 1}/${maxRetries})...`);
      await sleep(1000);
    }

    try {
      // 3a. 找状态筛选触发器
      const triggerResult = await client.evalJs(`
        (() => {
          // 策略1: 找"项目状态"标签的父容器
          const allLabels = Array.from(document.querySelectorAll('*'));
          for (const el of allLabels) {
            const t = el.textContent?.trim();
            if (t === '项目状态' && el.children?.length === 0 && el.offsetParent) {
              let p = el.parentElement;
              while (p && p.tagName !== 'BODY') {
                const trigger = p.querySelector('.ant-select-selector, [class*="select"][class*="trigger"]');
                if (trigger) { trigger.click(); return 'clicked_status_trigger'; }
                p = p.parentElement;
              }
            }
          }

          // 策略2: 找文字为"不限"且class含select的元素（可能当前已是不限）
          const selects = document.querySelectorAll('.ant-select-selector, .ovui-select');
          for (const sel of selects) {
            const t = sel.textContent?.trim();
            if (t === '不限' && sel.offsetParent) {
              sel.click();
              return 'clicked_current_unlimited';
            }
          }

          return 'no_status_trigger';
        })()
      `);
      detail.push(`trigger=${triggerResult}`);

      await sleep(1000);

      // 3b. 在dropdown中选"不限（包含已删除）"
      const selectResult = await client.evalJs(`
        (() => {
          // 找可见的dropdown
          const dropdowns = document.querySelectorAll(
            '.ant-select-dropdown:not([style*="display:none"]), .ovui-select-dropdown:not([style*="display:none"]), [class*="select"][class*="dropdown"]:not([style*="display:none"])'
          );

          for (const dd of dropdowns) {
            if (dd.offsetWidth === 0) continue;

            const options = dd.querySelectorAll('[role="option"], .ant-select-item, .ovui-option, li');
            for (const opt of options) {
              const t = opt.textContent?.trim();

              // 优先选"不限（包含已删除）"
              if (t.includes('不限') && t.includes('删除')) {
                opt.click();
                return 'selected_unlimited_deleted';
              }
              // 次选"不限"
              if (t === '不限') {
                opt.click();
                return 'selected_unlimited';
              }
            }

            // 兜底: 第一个option
            if (options.length > 0) {
              options[0].click();
              return 'selected_first=' + options[0].textContent?.trim()?.substring(0, 30);
            }
          }

          return 'no_dropdown_options';
        })()
      `);
      detail.push(`select=${selectResult}`);

      await sleep(1500);

      // 3c. 验证状态
      const verify = await client.evalJs(`
        (() => {
          const selects = document.querySelectorAll('.ant-select-selection-item, .ant-select-selector');
          const texts = Array.from(selects).map(s => s.textContent?.trim()).filter(Boolean);
          return texts.join('|');
        })()
      `);
      detail.push(`verify=${verify}`);

      if (verify.includes('不限')) {
        console.log(`    ✅ 状态校准成功: ${verify}`);
        return { ok: true, attempts: attempt + 1, detail: detail.join(' | ') };
      }

      console.log(`    ⚠ 状态校准未确认: ${verify}`);

    } catch (e) {
      detail.push(`error=${e.message.slice(0, 50)}`);
    }
  }

  return { ok: false, attempts: maxRetries, detail: detail.join(' | ') };
}

// ====== 步骤4: 按消耗降序排序 ======
async function calibrateSort(client, maxRetries = 3) {
  const detail = [];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // 4a. 检查当前排序状态
      const state = await client.evalJs(`
        (() => {
          const ths = document.querySelectorAll('th');
          for (const th of ths) {
            const t = (th.textContent || '').trim();
            if (t === '消耗' || t.includes('消耗(') || t.includes('消耗')) {
              const down = th.querySelector('.ovui-th__sorter-down');
              const up = th.querySelector('.ovui-th__sorter-up');
              return {
                found: true,
                downActive: !!(down?.className?.includes('--active')),
                upActive: !!(up?.className?.includes('--active')),
                hasColumnSorter: !!th.querySelector('.ovui-th__column-sorter'),
              };
            }
          }
          return { found: false };
        })()
      `);

      if (!state || !state.found) {
        detail.push('no_spend_column');
        // 等待页面渲染
        await sleep(2000);
        continue;
      }

      detail.push(`down=${state.downActive},up=${state.upActive}`);

      // 4b. 如果已降序，直接返回
      if (state.downActive) {
        console.log('    ℹ 消耗已降序，跳过');
        return { ok: true, attempts: attempt + 1, detail: detail.join(' | ') };
      }

      // 4c. 点击 column-sorter 切换
      const clickResult = await client.evalJs(`
        (() => {
          const ths = document.querySelectorAll('th');
          for (const th of ths) {
            if ((th.textContent || '').trim().includes('消耗')) {
              const sorter = th.querySelector('.ovui-th__column-sorter');
              if (!sorter) return { clicked: false, reason: 'no_sorter' };

              const rect = sorter.getBoundingClientRect();
              const cx = rect.x + rect.width / 2;
              const cy = rect.y + rect.height / 2;

              // OVUI状态机: 无排序→升序(↑)→降序(↓)→无排序
              // 如果用 PointerEvent + 真实坐标能直接触发
              sorter.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true, cancelable: true, clientX: cx, clientY: cy
              }));
              sorter.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true, cancelable: true, clientX: cx, clientY: cy
              }));
              sorter.dispatchEvent(new MouseEvent('click', {
                bubbles: true, cancelable: true, clientX: cx, clientY: cy
              }));

              return { clicked: true };
            }
          }
          return { clicked: false, reason: 'no_spend_th' };
        })()
      `);

      detail.push(`click=${clickResult?.clicked}`);

      await sleep(2500);

      // 4d. 验证
      const verifyState = await client.evalJs(`
        (() => {
          const ths = document.querySelectorAll('th');
          for (const th of ths) {
            if ((th.textContent || '').trim().includes('消耗')) {
              const down = th.querySelector('.ovui-th__sorter-down');
              const up = th.querySelector('.ovui-th__sorter-up');
              return {
                downActive: !!(down?.className?.includes('--active')),
                upActive: !!(up?.className?.includes('--active')),
                descending: !!(down?.className?.includes('--active')),
              };
            }
          }
          return { downActive: false };
        })()
      `);

      if (verifyState?.downActive) {
        console.log('    ✅ 消耗已降序');
        return { ok: true, attempts: attempt + 1, detail: detail.join(' | ') };
      }

      console.log(`    ⚠ 排序未确认为降序 (当前: ${verifyState?.downActive ? '降序' : verifyState?.upActive ? '升序' : '未排序'})`);

    } catch (e) {
      detail.push(`error=${e.message.slice(0, 50)}`);
    }
  }

  return { ok: false, attempts: maxRetries, detail: detail.join(' | ') };
}

// ====== 完整校准流程 ======
/**
 * 执行完整页面校准
 * @param {object} client - CDP客户端 (需有 evalJs 方法)
 * @param {object} [options]
 * @param {number} [options.dateRetries=3]
 * @param {number} [options.searchRetries=2]
 * @param {number} [options.statusRetries=3]
 * @param {number} [options.sortRetries=3]
 * @returns {Promise<CalibrationResult>}
 */
export async function calibratePage(client, options = {}) {
  const startTime = Date.now();
  console.log('  🔧 页面校准开始...');

  const stepResults = [];

  // 步骤0: 等待表格核心元素就绪
  console.log('    ⏳ 等待表格就绪...');
  const tableReady = await client.evalJs(`
    (() => {
      const rows = document.querySelectorAll('tbody tr').length;
      const pageSelect = !!document.querySelector('.ovui-page-select input');
      const spendTh = Array.from(document.querySelectorAll('th')).some(th => th.textContent?.trim().includes('消耗'));
      return { rows, pageSelect, spendTh, ready: rows > 0 && pageSelect && spendTh };
    })()
  `);

  stepResults.push({
    step: Step.READY,
    ok: tableReady?.ready || false,
    attempts: 1,
    detail: JSON.stringify(tableReady),
  });

  if (!tableReady?.ready) {
    console.log(`    ⚠ 表格未就绪: ${JSON.stringify(tableReady)}，等待额外时间...`);
    // 等待额外的6秒
    let waited = false;
    for (let i = 0; i < 12; i++) {
      await sleep(500);
      const check = await client.evalJs(`document.querySelectorAll('tbody tr').length > 0`);
      if (check) { waited = true; break; }
    }
  }

  // 步骤1: 日期→今天
  console.log('    📅 校准日期...');
  const dateRes = await calibrateDate(client, options.dateRetries || 3);
  stepResults.push({ step: Step.DATE, ...dateRes });

  // 步骤2: 清空搜索框（非关键）
  console.log('    🧹 清空搜索...');
  const searchRes = await calibrateSearch(client, options.searchRetries || 2);
  stepResults.push({ step: Step.SEARCH, ...searchRes });

  // 步骤3: 状态→不限
  console.log('    🔘 校准状态...');
  const statusRes = await calibrateStatus(client, options.statusRetries || 3);
  stepResults.push({ step: Step.STATUS, ...statusRes });

  // 步骤4: 消耗降序
  console.log('    📊 校准排序...');
  const sortRes = await calibrateSort(client, options.sortRetries || 3);
  stepResults.push({ step: Step.SORT, ...sortRes });

  const elapsed = Date.now() - startTime;
  const allOk = stepResults.every(s => s.ok);

  console.log(`  ${allOk ? '✅' : '⚠️'} 页面校准完成 (${elapsed}ms): ${stepResults.map(s => `${s.step}=${s.ok ? '✅' : '❌'}`).join(' ')}`);

  return { allOk, steps: stepResults, totalTime: elapsed };
}

/**
 * 快速校准（仅关键步骤）
 * @param {object} client
 * @returns {Promise<CalibrationResult>}
 */
export async function quickCalibrate(client) {
  return calibratePage(client, {
    searchRetries: 1,
    statusRetries: 1,
    sortRetries: 1,
  });
}

export default {
  calibratePage,
  quickCalibrate,
  Step,
  calibrateDate,
  calibrateSearch,
  calibrateStatus,
  calibrateSort,
};
