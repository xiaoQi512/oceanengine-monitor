// 金额/数字格式化
function fmtMoney(n, withSymbol = true) {
  if (n === null || n === undefined || isNaN(n)) return withSymbol ? '¥--' : '--'
  const s = Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: n < 100 ? 2 : 0 })
  return withSymbol ? '¥' + s : s
}

function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '--'
  return Number(n).toLocaleString('zh-CN')
}

// 涨跌百分比文字: { text: '+5.9%', cls: 'up'|'down'|'neutral' } (涨红跌绿)
function fmtDelta(pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return { text: '--', cls: 'neutral' }
  const v = Number(pct)
  if (v > 0.5) return { text: '+' + v.toFixed(1) + '%', cls: 'up' }
  if (v < -0.5) return { text: v.toFixed(1) + '%', cls: 'down' }
  return { text: '持平', cls: 'neutral' }
}

function fmtTime(iso) {
  if (!iso) return '--:--'
  const d = new Date(iso)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

module.exports = { fmtMoney, fmtNum, fmtDelta, fmtTime }
