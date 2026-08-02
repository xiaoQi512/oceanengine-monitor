// src/cdp/page-actions.mjs - 巨量引擎页面通用 CDP 操作
import { setTimeout as sleep } from 'node:timers/promises';
import { waitForTableRows } from '../utils/wait-utils.mjs';

export async function closePopups(client) {
  try {
    await client.evalJs(`
      (() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        const popupKeywords = ['立即体验', '我知道了', '知道了', '升级'];
        let closed = [];
        for (const btn of btns) {
          const t = btn.textContent?.trim();
          if (popupKeywords.includes(t) && btn.offsetParent) {
            btn.click();
            closed.push(t);
          }
        }
        return closed;
      })()
    `);
  } catch {}
}

export async function waitForTableReady(client, timeoutMs = 60000) {
  return waitForTableRows(client, 1, {
    timeout: timeoutMs,
    pollInterval: 1000,
    skipSummary: true,
  });
}

export async function hasNextPage(client) {
  const r = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const nextBtn = document.querySelector('.ovui-pagination__next');
      if (!nextBtn) return JSON.stringify({ hasNext: false, reason: 'no next button' });
      const isDisabled = nextBtn.classList.contains('disabled') || nextBtn.getAttribute('aria-disabled') === 'true';
      return JSON.stringify({ hasNext: !isDisabled, disabled: isDisabled });
    })()`,
    returnByValue: true
  });
  try { const v = JSON.parse(r?.result?.result?.value || '{}'); return v.hasNext || false; } catch { return false; }
}

export async function clickNextPage(client) {
  const r = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const nextBtn = document.querySelector('.ovui-pagination__next');
      if (nextBtn && !nextBtn.classList.contains('disabled')) {
        nextBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        nextBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
        nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return JSON.stringify({ clicked: true });
      }
      return JSON.stringify({ clicked: false });
    })()`,
    returnByValue: true
  });
  await sleep(3000);
  return true;
}
