// scripts/check-pm2-paths.mjs - PM2 配置启动路径一致性检查
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const config = require('../ecosystem.config.cjs');
const apps = config.apps || [];

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

assert.ok(apps.length > 0, 'ecosystem.config.cjs 应包含 PM2 应用');
const seen = new Set();
for (const app of apps) {
  assert.ok(app.name, 'PM2 应用应包含 name');
  assert.ok(!seen.has(app.name), `重复的 PM2 应用名: ${app.name}`);
  seen.add(app.name);
  const cwd = app.cwd || PROJECT_ROOT;
  const script = path.resolve(cwd, app.script);
  assert.ok(fs.existsSync(script), `${app.name} 脚本不存在: ${script}`);
  assert.ok(fs.existsSync(path.resolve(cwd)), `${app.name} 工作目录不存在: ${cwd}`);
  assert.ok(app.env && typeof app.env === 'object', `${app.name} 应包含 env 对象`);
  if (app.args !== undefined) {
    assert.ok(typeof app.args === 'string' || Array.isArray(app.args), `${app.name} args 应为字符串或数组`);
  }
  if (app.autorestart === false) {
    assert.ok(app.cron_restart, `${app.name} 跑完即退应用应配置 cron_restart`);
  }
  if (app.cron_restart) {
    assert.strictEqual(typeof app.cron_restart, 'string', `${app.name} cron_restart 应为字符串`);
  } else {
    assert.notStrictEqual(app.autorestart, false, `${app.name} 常驻应用应启用 autorestart`);
  }
  if (app.out_file) {
    const logDir = path.dirname(path.resolve(cwd, app.out_file));
    assert.ok(fs.existsSync(logDir), `${app.name} 日志目录不存在: ${logDir}`);
  }
  if (app.error_file) {
    const logDir = path.dirname(path.resolve(cwd, app.error_file));
    assert.ok(fs.existsSync(logDir), `${app.name} 错误日志目录不存在: ${logDir}`);
  }
  if (app.interpreter) {
    if (!(process.platform !== 'win32' && isWindowsAbsolutePath(app.interpreter))) {
      const interpreter = path.resolve(cwd, app.interpreter);
      assert.ok(fs.existsSync(interpreter), `${app.name} Node 解释器不存在: ${interpreter}`);
    }
  }
}

console.log(`\n全部测试通过 (${apps.length} 个 PM2 应用配置一致)`);
