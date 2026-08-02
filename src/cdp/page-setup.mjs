// src/cdp/page-setup.mjs - 巨量引擎页面分页/排序设置
import { setTimeout as sleep } from 'node:timers/promises';

export async function setPageSize(client, size = 50) {
  console.log(`  设置每页${size}条...`);

  const r0 = await client.send('Runtime.evaluate', {
    expression: `document.querySelector('.ovui-page-select input')?.value`,
    returnByValue: true
  });
  const current = r0?.result?.result?.value;
  if (current === `${size}条/页`) {
    console.log(`  已是${size}条/页，跳过`);
    return true;
  }

  const rBox = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const sel = document.querySelector('.ovui-page-select .ovui-select');
      if (!sel) return JSON.stringify({ found: false });
      const rect = sel.getBoundingClientRect();
      return JSON.stringify({ found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: rect.width, h: rect.height });
    })()`,
    returnByValue: true
  });
  const box = JSON.parse(rBox?.result?.result?.value || '{"found":false}');
  if (!box.found) {
    console.log('  ⚠ 未找到分页select元素');
    return false;
  }
  console.log(`  select中心: (${Math.round(box.x)}, ${Math.round(box.y)})`);

  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await sleep(100);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(50);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(1500);

  const r1 = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const popper = document.querySelector('.ovui-select__popper--show');
      if (!popper) return JSON.stringify({ open: false });
      const opts = popper.querySelectorAll('.ovui-option');
      const texts = Array.from(opts).map(o => o.textContent?.trim());
      return JSON.stringify({ open: true, options: texts });
    })()`,
    returnByValue: true
  });
  const dropdown = JSON.parse(r1?.result?.result?.value || '{"open":false}');

  if (!dropdown.open) {
    console.log('  下拉未打开，用CDP重试点击...');
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await sleep(100);
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(50);
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(2000);

    const r1b = await client.send('Runtime.evaluate', {
      expression: `(()=>{
        const popper = document.querySelector('.ovui-select__popper--show');
        if (!popper) return JSON.stringify({ open: false });
        const opts = popper.querySelectorAll('.ovui-option');
        const texts = Array.from(opts).map(o => o.textContent?.trim());
        return JSON.stringify({ open: true, options: texts });
      })()`,
      returnByValue: true
    });
    const dd2 = JSON.parse(r1b?.result?.result?.value || '{"open":false}');
    if (!dd2.open) {
      console.log('  ❌ 下拉框仍无法打开');
      return false;
    }
    Object.assign(dropdown, dd2);
  }
  console.log(`  下拉已打开: ${dropdown.options?.join('/')}`);

  const targetText = `${size}条/页`;
  const rOpt = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const popper = document.querySelector('.ovui-select__popper--show');
      if (!popper) return JSON.stringify({ found: false });
      const opts = popper.querySelectorAll('.ovui-option');
      for (const opt of opts) {
        if (opt.textContent?.trim() === '${targetText}') {
          const rect = opt.getBoundingClientRect();
          return JSON.stringify({ found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: opt.textContent?.trim() });
        }
      }
      return JSON.stringify({ found: false, options: Array.from(opts).map(o => o.textContent?.trim()) });
    })()`,
    returnByValue: true
  });
  const optBox = JSON.parse(rOpt?.result?.result?.value || '{"found":false}');

  if (!optBox.found) {
    console.log(`  ❌ 未找到"${targetText}"选项，现有: ${optBox.options?.join('/')}`);
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 10, y: 10, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 10, y: 10, button: 'left', clickCount: 1 });
    return false;
  }
  console.log(`  目标选项中心: (${Math.round(optBox.x)}, ${Math.round(optBox.y)})`);

  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: optBox.x, y: optBox.y });
  await sleep(100);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: optBox.x, y: optBox.y, button: 'left', clickCount: 1 });
  await sleep(50);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: optBox.x, y: optBox.y, button: 'left', clickCount: 1 });

  console.log(`  CDP点击完成: ${optBox.text}`);
  await sleep(2000);

  const r3 = await client.send('Runtime.evaluate', {
    expression: `document.querySelector('.ovui-page-select input')?.value`,
    returnByValue: true
  });
  const newVal = r3?.result?.result?.value;
  console.log(`  当前每页: ${newVal}`);

  if (newVal === `${size}条/页`) {
    console.log(`  ✅ 页面大小已设置为${size}条/页`);
    return true;
  }

  console.log(`  ⚠ 验证失败，当前值=${newVal}，等待重查...`);
  await sleep(3000);
  const r4 = await client.send('Runtime.evaluate', {
    expression: `document.querySelector('.ovui-page-select input')?.value`,
    returnByValue: true
  });
  const finalVal = r4?.result?.result?.value;
  console.log(`  最终每页: ${finalVal}`);
  return finalVal === `${size}条/页`;
}

export async function sortBySpend(client) {
  console.log('  按消耗降序排序 (倒序)...');

  const r0 = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const headers = document.querySelectorAll('th');
      for (const th of headers) {
        const t = th.textContent?.trim();
        if (t === '消耗' || t === '消耗(元)' || t.includes('消耗(')) {
          const sorterDown = th.querySelector('.ovui-th__sorter-down');
          const sorterUp = th.querySelector('.ovui-th__sorter-up');
          const downActive = sorterDown?.className?.includes('--active') || false;
          const upActive = sorterUp?.className?.includes('--active') || false;
          return JSON.stringify({
            found: true, colText: t,
            downActive: !!downActive,
            upActive: !!upActive,
            downCls: sorterDown?.className?.toString()?.slice(0, 80) || 'null',
            upCls: sorterUp?.className?.toString()?.slice(0, 80) || 'null',
            noSort: !downActive && !upActive,
          });
        }
      }
      return JSON.stringify({ found: false });
    })()`,
    returnByValue: true
  });

  const state = JSON.parse(r0?.result?.result?.value || '{"found":false}');
  console.log(`  排序状态: ${state.found ? '↓激活='+state.downActive+' ↑激活='+state.upActive+' 无排序='+state.noSort : '未找到消耗列'}`);

  if (state.downActive) {
    console.log('  已是降序(倒序)，无需切换');
    return;
  }

  const r1 = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const headers = document.querySelectorAll('th');
      for (const th of headers) {
        if ((th.textContent?.trim()||'').includes('消耗')) {
          const sorter = th.querySelector('.ovui-th__column-sorter');
          if (sorter) {
            const rect = sorter.getBoundingClientRect();
            const cx = rect.x + rect.width / 2;
            const cy = rect.y + rect.height / 2;
            sorter.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
            sorter.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
            sorter.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
            return JSON.stringify({ clicked: true, target: 'column-sorter', rect: { x: Math.round(rect.x), y: Math.round(rect.y) } });
          }
          return JSON.stringify({ clicked: false, reason: 'no column-sorter', thHas: th.querySelector('.ovui-th__sorter') ? 'sorter' : 'none' });
        }
      }
      return JSON.stringify({ clicked: false, reason: 'no spend column' });
    })()`,
    returnByValue: true
  });

  const clickResult = JSON.parse(r1?.result?.result?.value || '{"clicked":false}');
  console.log(`  排序点击: ${clickResult.clicked ? '✅已触发 column-sorter @ ('+clickResult.rect?.x+','+clickResult.rect?.y+')' : '❌'+clickResult.reason}`);

  await sleep(2500);

  const r2 = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const headers = document.querySelectorAll('th');
      for (const th of headers) {
        if ((th.textContent?.trim()||'').includes('消耗')) {
          const down = th.querySelector('.ovui-th__sorter-down');
          return JSON.stringify({ downActive: !!(down?.className?.includes('--active')) });
        }
      }
      return JSON.stringify({ error: 'not found' });
    })()`,
    returnByValue: true
  });
  const verify = JSON.parse(r2?.result?.result?.value || '{"error":true}');
  console.log(`  排序验证: ${verify.downActive ? '✅降序(倒序)' : '❌未降序，继续尝试...'}`);

  if (!verify.downActive) {
    console.log('  回退: 点sorter-down两次...');
    for (let i = 0; i < 2; i++) {
      await client.send('Runtime.evaluate', {
        expression: `(()=>{
          const headers = document.querySelectorAll('th');
          for (const th of headers) {
            if ((th.textContent?.trim()||'').includes('消耗')) {
              const down = th.querySelector('.ovui-th__sorter-down');
              if (down) { down.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 'clicked'; }
            }
          }
        })()`,
        returnByValue: true
      });
      await sleep(1500);
    }
  }

  await sleep(2000);
}
