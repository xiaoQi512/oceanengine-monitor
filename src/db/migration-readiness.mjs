// src/db/migration-readiness.mjs - v2 schema 就绪检查（纯函数）

const REQUIRED_TABLES = [
  'schema_migrations',
  'campaigns',
  'snapshots',
  'daily_summaries',
  'shift_metrics',
  'alerts',
  'actions',
  'feedback',
  'config',
  'telemetry',
];

const REQUIRED_SNAPSHOT_COLUMNS = [
  'snapshot_time',
  'snapshot_cst',
  'campaign_id',
  'cost',
  'leads',
  'conversions',
  'msg_open',
  'msg_lead',
  'form_submit',
  'ctr',
  'cpm',
  'cvr',
  'views',
  'views_1min',
  'comments',
  'source_type',
  'status',
  'page_summary_json',
  'raw_json',
];

export function checkV2Schema(db) {
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  );
  const missingTables = REQUIRED_TABLES.filter(t => !tables.has(t));

  const snapshotCols = new Set(
    db.prepare('PRAGMA table_info(snapshots)').all().map(c => c.name)
  );
  const missingSnapshotCols = REQUIRED_SNAPSHOT_COLUMNS.filter(c => !snapshotCols.has(c));

  let schemaVersion = '';
  try {
    schemaVersion = db.prepare("SELECT value FROM config WHERE key='schema_version'").get()?.value || '';
  } catch {}

  return {
    ok: missingTables.length === 0 && missingSnapshotCols.length === 0 && schemaVersion === '2.0',
    missingTables,
    missingSnapshotCols,
    schemaVersion,
  };
}
