// scripts/backfill-shift-metrics.mjs - 重构停机期间主播消耗补录
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new Database(path.join(ROOT, 'monitor-data', 'oceanengine.db'));

const rows = [
  { date: '2026-08-01', shift_label: '19:30-21:30', anchor_name: '李咪', spend: 7714.35, leads: 81, cpl: 95.24, carModel: '贝塔S3' },
  { date: '2026-08-01', shift_label: '21:30-23:30', anchor_name: '三水', spend: 9045.54, leads: 93, cpl: 97.26, carModel: '极狐' },
  { date: '2026-08-02', shift_label: '05:30-07:30', anchor_name: '张萌', spend: 5253.95, leads: 46, cpl: 114.22, carModel: '贝塔S3' },
  { date: '2026-08-02', shift_label: '07:30-09:30', anchor_name: '芝芝', spend: 7721.74, leads: 94, cpl: 82.15, carModel: '贝塔S3' },
];

const stmt = db.prepare(`
  INSERT INTO shift_metrics(date, shift_label, anchor_name, spend, leads, cpl, source, detail_json)
  VALUES (@date, @shift_label, @anchor_name, @spend, @leads, @cpl, 'manual_fill', @detail_json)
  ON CONFLICT(date, shift_label) DO UPDATE SET
    anchor_name=excluded.anchor_name,
    spend=excluded.spend,
    leads=excluded.leads,
    cpl=excluded.cpl,
    source=excluded.source,
    detail_json=excluded.detail_json
`);

const tx = db.transaction(() => {
  for (const r of rows) {
    stmt.run({ ...r, detail_json: JSON.stringify({ carModel: r.carModel, note: '重构停机补录' }) });
  }
});
tx();
db.close();
console.log(`backfilled=${rows.length}`);
