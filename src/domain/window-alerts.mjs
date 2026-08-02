// src/domain/window-alerts.mjs - 3h 窗口波动告警（纯逻辑）

export function buildWindow3hAlerts(window3h) {
  const alerts = [];
  if (!window3h) return alerts;

  if (window3h.speed.change > 0.5 && window3h.spend.second > 200) {
    const excess = (window3h.speed.change * 100).toFixed(0);
    alerts.push({
      type: 'speed_3h',
      name: '3h消耗速度飙升',
      detail: `近${window3h.secondHours}h均速 ¥${window3h.speed.second.toFixed(0)}/min，较前${window3h.firstHours}h ¥${window3h.speed.first.toFixed(0)}/min 涨 ${excess}%`,
      severity: window3h.speed.change > 1.0 ? 'high' : 'medium',
    });
  } else if (window3h.speed.change < -0.5 && window3h.spend.first > 200) {
    const drop = (Math.abs(window3h.speed.change) * 100).toFixed(0);
    alerts.push({
      type: 'speed_3h',
      name: '3h消耗速度骤降',
      detail: `近${window3h.secondHours}h均速 ¥${window3h.speed.second.toFixed(0)}/min，较前${window3h.firstHours}h ¥${window3h.speed.first.toFixed(0)}/min 跌 ${drop}%`,
      severity: 'medium',
    });
  }

  if (window3h.cpa.first > 0 && window3h.cpa.second > 0 && window3h.cpa.change > 0.25) {
    const rise = (window3h.cpa.change * 100).toFixed(0);
    alerts.push({
      type: 'cpa_3h',
      name: '3h成本持续攀升',
      detail: `近${window3h.secondHours}h CPL ¥${window3h.cpa.second.toFixed(0)}，较前${window3h.firstHours}h ¥${window3h.cpa.first.toFixed(0)} 涨 ${rise}%`,
      severity: window3h.cpa.change > 0.5 ? 'high' : 'medium',
    });
  }

  if (window3h.convRate.change < -0.3 && window3h.convRate.second > 0) {
    const drop = (Math.abs(window3h.convRate.change) * 100).toFixed(0);
    alerts.push({
      type: 'conv_drop_3h',
      name: '3h转化效率下降',
      detail: `近${window3h.secondHours}h 每千元转化 ${window3h.convRate.second.toFixed(1)}，较前${window3h.firstHours}h ${window3h.convRate.first.toFixed(1)} 跌 ${drop}%`,
      severity: window3h.convRate.change < -0.5 ? 'high' : 'medium',
    });
  }

  if (window3h.burnRate.change > 0.6 && window3h.burnRate.second > 500) {
    const accel = (window3h.burnRate.change * 100).toFixed(0);
    alerts.push({
      type: 'burn_accel_3h',
      name: '消耗加速度异常',
      detail: `近${window3h.secondHours}h燃烧速率 ¥${window3h.burnRate.second.toFixed(0)}/h，较前${window3h.firstHours}h ¥${window3h.burnRate.first.toFixed(0)}/h 加速 ${accel}%`,
      severity: window3h.burnRate.change > 1.2 ? 'high' : 'medium',
    });
  }

  return alerts;
}
