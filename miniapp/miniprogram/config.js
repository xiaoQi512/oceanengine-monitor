// 全局配置 - 上架前需手动替换以下两项
module.exports = {
  // ① 云开发环境ID（云开发控制台首页可见，形如 cloud1-2gxxxxx123）
  CLOUD_ENV: 'cloud1-d8g6hfz1j29f13557',
  // ② 云托管服务名（云托管控制台-服务列表可见）
  CALL_CONTAINER_SERVICE: 'monitor-api',
  // 演示模式: 云端无数据时使用内置演示数据（体验版期间可开着看效果）
  USE_MOCK_FALLBACK: true
}
