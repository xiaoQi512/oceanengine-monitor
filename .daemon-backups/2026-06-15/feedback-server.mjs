// feedback-server.mjs — 本地 HTTP 服务 (端口 8899)
// 功能: 1. 提供 HTML 报表查看  2. 接收飞书卡片建议的 是/否 反馈
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  getLocalDate, loadSuggestionHistory, saveSuggestionHistory, recalcSummary,
  DATA_DIR, HISTORY_FILE, FEEDBACK_PORT, ACCOUNT_NAME,
} from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_FILE = path.join(__dirname, 'oceanengine-report.html');

// ====== 输入校验 ======
const MAX_PARAM_LENGTH = 256;
function sanitize(str) { return String(str || '').slice(0, MAX_PARAM_LENGTH); }

// ====== 分布式锁 (防 TOCTOU 竞态) ======
let writeLock = null;
function acquireLock() {
  if (writeLock) return false;
  writeLock = Date.now();
  return true;
}
function releaseLock() { writeLock = null; }

// ====== 反馈记录 ======
function recordFeedback(alertId, action, campaignId, type, name) {
  // 重试最多3次（避免并发写竞争）
  for (let retry = 0; retry < 3; retry++) {
    if (!acquireLock()) { releaseLock(); continue; }
    try {
      const history = loadSuggestionHistory();
      
      const existing = history.suggestions.find(s => s.id === alertId);
      if (existing) {
        existing.response = action;
        existing.responseTime = new Date().toISOString();
      } else {
        history.suggestions.push({
          id: alertId,
          time: new Date().toISOString(),
          alertType: type,
          campaignId: campaignId || '',
          campaignName: decodeURIComponent(name || ''),
          suggestion: type === 'zero_conv' ? '暂停零转化计划' : type === 'high_cpa' ? '关停高成本计划' : '执行优化操作',
          response: action,
          responseTime: new Date().toISOString(),
        });
      }
      
      recalcSummary(history);
      saveSuggestionHistory(history);
      releaseLock();
      return history;
    } catch (e) {
      releaseLock();
      if (retry >= 2) throw e;
    }
  }
  return null;
}

// ====== HTTP Server ======
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${FEEDBACK_PORT}`);
  
  // 健康检查
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
    return;
  }
  
  // 报表
  if (url.pathname === '/report' || url.pathname === '/') {
    try {
      if (!fs.existsSync(REPORT_FILE)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>📄 报表尚未生成</h2><p>等待监控脚本首次运行...</p></body></html>`);
        return;
      }
      const html = fs.readFileSync(REPORT_FILE, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Server Error');
    }
    return;
  }
  
  // 日报
  if (url.pathname === '/daily' || url.pathname.startsWith('/daily-')) {
    const today = getLocalDate();
    const dailyFile = path.join(__dirname, `oceanengine-daily-${today}.html`);
    const latestFile = path.join(__dirname, 'oceanengine-daily-latest.html');
    try {
      const file = fs.existsSync(dailyFile) ? dailyFile : (fs.existsSync(latestFile) ? latestFile : null);
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>📊 日报尚未生成</h2><p>每天23:05自动生成，届时可通过此链接查看</p></body></html>`);
        return;
      }
      const html = fs.readFileSync(file, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Server Error');
    }
    return;
  }
  
  // 建议反馈 (带输入校验)
  if (url.pathname === '/feedback') {
    const action = sanitize(url.searchParams.get('action'));
    const alertId = sanitize(url.searchParams.get('alertId'));
    const campaignId = sanitize(url.searchParams.get('campaignId'));
    const type = sanitize(url.searchParams.get('type'));
    const name = sanitize(url.searchParams.get('name'));
    
    if (!action || !['accept', 'reject'].includes(action) || alertId.length > 100) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>❌ 参数错误或过长</h2></body></html>`);
      return;
    }
    
    recordFeedback(alertId, action, campaignId, type, name);
    
    const actionLabel = action === 'accept' ? '✅ 已采纳' : '❌ 已拒绝';
    const suggestionLabel = type === 'zero_conv' ? '暂停零转化计划' : type === 'high_cpa' ? '关停高成本计划' : type === 'budget_cap' ? '追加预算' : '优化操作';
    
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>反馈已记录</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f7fa;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:16px;padding:48px 40px;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;max-width:420px}
.icon{font-size:48px;margin-bottom:16px}
h2{font-size:22px;color:#2c3e50;margin-bottom:8px}
p{font-size:14px;color:#64748b;margin-bottom:4px;line-height:1.6}
.note{font-size:12px;color:#94a3b8;margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9}
</style>
</head>
<body>
<div class="card">
  <div class="icon">${action === 'accept' ? '✅' : '❌'}</div>
  <h2>${actionLabel}</h2>
  <p>建议: ${suggestionLabel}</p>
  ${name ? `<p>计划: ${decodeURIComponent(name)}</p>` : ''}
  <p style="margin-top:8px">反馈时间: ${new Date().toLocaleString('zh-CN')}</p>
  <div class="note">此反馈将影响后续建议策略 · 可关闭此页面</div>
</div>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  
  // 建议历史查看
  if (url.pathname === '/history') {
    const history = loadSuggestionHistory();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(history, null, 2));
    return;
  }
  
  // 标记忽略（由监控脚本调用）
  if (url.pathname === '/mark-ignored') {
    const alertIds = sanitize(url.searchParams.get('ids'));
    if (alertIds) {
      const ids = alertIds.split(',').map(s => s.trim()).filter(s => s.length > 0);
      const history = loadSuggestionHistory();
      for (const id of ids) {
        const existing = history.suggestions.find(s => s.id === id);
        if (existing && !existing.response) {
          existing.response = 'ignored';
          existing.responseTime = new Date().toISOString();
        }
      }
      recalcSummary(history);
      saveSuggestionHistory(history);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  
  // 404
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>404 Not Found</h2></body></html>`);
});

server.listen(FEEDBACK_PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  let lanIP = '127.0.0.1';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && (net.address.startsWith('192.168.') || net.address.startsWith('10.'))) {
        lanIP = net.address;
      }
    }
  }
  console.log(`📡 反馈服务器已启动: http://0.0.0.0:${FEEDBACK_PORT}`);
  console.log(`   本机报表: http://127.0.0.1:${FEEDBACK_PORT}/report`);
  console.log(`   局域网报表: http://${lanIP}:${FEEDBACK_PORT}/report`);
  console.log(`   历史: http://127.0.0.1:${FEEDBACK_PORT}/history`);
});

// 优雅退出
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
