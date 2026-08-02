// tests/live-watcher-run.test.mjs - 直播间状态监听运行编排入口测试
import assert from 'node:assert';
import { runLiveWatcher } from '../src/services/live-watcher-run.mjs';

assert.strictEqual(typeof runLiveWatcher, 'function');

console.log('\n全部测试通过');
