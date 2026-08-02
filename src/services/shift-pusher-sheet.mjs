// src/services/shift-pusher-sheet.mjs - 换班飞书表写入与主播名读取

export async function writeShiftToSheet({
  row,
  totalConsume,
  totalLeads,
  runLarkCliAsync,
  withRetry,
  spreadsheetToken,
  sheetId,
  label,
  logFn = console.log,
  logErrorFn = console.error,
}) {
  try {
    const cells = JSON.stringify([[
      { value: Math.round(totalConsume * 100) / 100 },
      { value: totalLeads },
      { value: totalLeads > 0 ? Math.round((totalConsume / totalLeads) * 100) / 100 : 0 },
    ]]);
    await withRetry(
      () => runLarkCliAsync([
        'sheets', '+cells-set',
        '--spreadsheet-token', spreadsheetToken,
        '--sheet-id', sheetId,
        '--range', 'D' + row + ':F' + row,
        '--cells', cells,
      ]),
      label + ' 写表'
    );
    logFn('✅ 已写表 D' + row + ':F' + row);
  } catch (e) {
    logErrorFn('写飞书表失败 ' + label + ' (已重试):', e.message);
  }
}

export function readAnchorNameFromSheet({
  row,
  label = String(row),
  runLarkCli,
  spreadsheetToken,
  sheetId,
  logFn = console.log,
  logErrorFn = console.error,
}) {
  let anchorName = '未知';
  try {
    const csvOut = runLarkCli([
      'sheets', '+csv-get',
      '--spreadsheet-token', spreadsheetToken,
      '--sheet-id', sheetId,
      '--range', 'A' + row + ':C' + row,
    ]);
    const parsed = JSON.parse(csvOut);
    const annotated = parsed?.data?.annotated_csv || '';
    const cols = annotated.split(',');
    if (cols.length >= 3) anchorName = cols[2].trim();
    logFn('👤 主播: ' + anchorName);
  } catch (e) {
    logErrorFn('读主播名失败 ' + label + ':', e.message);
  }
  return anchorName;
}
