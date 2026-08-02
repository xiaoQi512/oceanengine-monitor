// tests/monitor-state.test.mjs - 监控状态与建议历史测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordDataGap, recordPendingSuggestions, markIgnoredSuggestions } from '../src/services/monitor-state.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oec-monitor-state-'));
try {
  const atomicWriteJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data));
  recordDataGap('test gap', {
    dataDir: dir,
    getLocalDate: () => '2026-08-02',
    atomicWriteJSON,
  });
  assert.ok(fs.existsSync(path.join(dir, 'daily-2026-08-02.json')));

  let history = { suggestions: [], summary: {} };
  recordPendingSuggestions([{ id: '1', alertType: 'high_cpa' }], {
    loadSuggestionHistory: () => history,
    saveSuggestionHistory: (h) => { history = h; },
    recalcSummary: () => {},
  });
  assert.strictEqual(history.suggestions.length, 1);

  history.suggestions = [{ id: '1', time: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(), response: null }];
  markIgnoredSuggestions({
    loadSuggestionHistory: () => history,
    saveSuggestionHistory: (h) => { history = h; },
    recalcSummary: () => {},
  });
  assert.strictEqual(history.suggestions[0].response, 'ignored');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
