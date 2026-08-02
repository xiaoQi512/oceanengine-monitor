// src/services/http-routes/api-feedback.mjs - 建议反馈页面
export async function serveFeedback(url, req, res, ctx) {
  if (url.pathname !== '/feedback') return false;

  const { sanitize, escHtml, recordFeedback } = ctx;
  const action = sanitize(url.searchParams.get('action'));
  const alertId = sanitize(url.searchParams.get('alertId'));
  const campaignId = sanitize(url.searchParams.get('campaignId'));
  const type = sanitize(url.searchParams.get('type'));
  const name = sanitize(url.searchParams.get('name'));

  if (!action || !['accept', 'reject'].includes(action) || alertId.length > 100) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>❌ 参数错误或过长</h2></body></html>`);
    return true;
  }

  try {
    await recordFeedback(alertId, action, campaignId, type, name);
  } catch (e) {
    console.error('记录反馈失败:', e.message);
  }

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
  ${name ? `<p>计划: ${escHtml(decodeURIComponent(name))}</p>` : ''}
  <p style="margin-top:8px">反馈时间: ${new Date().toLocaleString('zh-CN')}</p>
  <div class="note">此反馈将影响后续建议策略 · 可关闭此页面</div>
</div>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
  return true;
}
