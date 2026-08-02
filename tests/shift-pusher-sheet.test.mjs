// tests/shift-pusher-sheet.test.mjs - 换班飞书表写入与主播名读取测试
import assert from 'node:assert';
import { writeShiftToSheet, readAnchorNameFromSheet } from '../src/services/shift-pusher-sheet.mjs';

let wrote = null;
await writeShiftToSheet({
  row: 200,
  totalConsume: 100,
  totalLeads: 5,
  runLarkCliAsync: async args => { wrote = args; return true; },
  withRetry: async fn => fn(),
  spreadsheetToken: 'token',
  sheetId: 'sheet',
  label: '09:00-12:00',
  logFn: () => {},
  logErrorFn: () => {},
});
assert.ok(wrote.includes('D200:F200'));

const anchor = readAnchorNameFromSheet({
  row: 200,
  runLarkCli: () => JSON.stringify({ data: { annotated_csv: 'a,b,主播A' } }),
  spreadsheetToken: 'token',
  sheetId: 'sheet',
  logFn: () => {},
  logErrorFn: () => {},
});
assert.strictEqual(anchor, '主播A');

console.log('\n全部测试通过');
