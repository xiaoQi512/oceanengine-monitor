// src/domain/shift-schedule.mjs - 换班结束时间判断与排班表解析（纯逻辑）

export function normalizeShiftLabel(label) {
  const m = String(label || '').match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return String(label || '');
  return `${m[1].padStart(2, '0')}:${m[2]}-${m[3].padStart(2, '0')}:${m[4]}`;
}

export function getShiftEndMinutes(shift) {
  const m = normalizeShiftLabel(shift.label).match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
  if (!m) return -1;
  return parseInt(m[3]) * 60 + parseInt(m[4]);
}

export function isShiftEnded(shift, now) {
  const endMin = getShiftEndMinutes(shift);
  if (endMin < 0) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= endMin && nowMin <= endMin + 30;
}

const pad = n => String(n).padStart(2, '0');

// 排班表 A 列日期归一化:"2026-08-17" / "8月17日" / "8-17" → "2026-08-17"
export function normalizeSheetDate(value, dateStr) {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;

  const cn = text.match(/^(\d{1,2})月(\d{1,2})日/);
  if (cn) {
    const year = Number(String(dateStr || '').slice(0, 4)) || new Date().getFullYear();
    return `${year}-${pad(cn[1])}-${pad(cn[2])}`;
  }

  const short = text.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (short) {
    const year = Number(String(dateStr || '').slice(0, 4)) || new Date().getFullYear();
    return `${year}-${pad(short[1])}-${pad(short[2])}`;
  }

  return '';
}

function startMinutes(label) {
  const m = label.match(/^(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

// 解析 lark-cli annotated_csv:过滤指定日期的班次行
// 返回 [{ label, hours, row, anchorName }],按开始时间升序
export function parseShiftRowsByDate(csv, dateStr) {
  const targetIso = normalizeSheetDate(dateStr, dateStr);
  const shifts = [];

  for (const line of String(csv || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const prefix = line.match(/^\[row=(\d+)\]\s*(.*)$/);
    const payload = prefix ? prefix[2] : line;
    const cols = payload.split(',');
    const dateCell = (cols[0] || '').trim();
    if (normalizeSheetDate(dateCell, dateStr) !== targetIso) continue;

    const timeMatch = (cols[1] || '').trim().match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
    if (!timeMatch) continue;

    const startH = Number(timeMatch[1]);
    const startM = Number(timeMatch[2]);
    const endH = Number(timeMatch[3]);
    const endM = Number(timeMatch[4]);
    const hours = [];
    for (let h = startH; h <= endH; h++) {
      if (h === endH && endM === 0) continue;
      hours.push(h);
    }

    shifts.push({
      label: normalizeShiftLabel(`${pad(startH)}:${pad(startM)}-${pad(endH)}:${pad(endM)}`),
      hours,
      row: prefix ? Number(prefix[1]) : null,
      anchorName: (cols[2] || '').trim(),
    });
  }

  shifts.sort((a, b) => startMinutes(a.label) - startMinutes(b.label));
  return shifts;
}
