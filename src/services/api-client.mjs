// src/services/api-client.mjs - 服务层 API 客户端适配器
// 负责把 CDP Cookie 提取实现注入 platform，避免 platform 反向依赖 cdp
import { setCookieExtractor } from '../platform/oec-client.mjs';
import { extractCookiesFromBrowser } from '../cdp/cookie-provider.mjs';

setCookieExtractor(extractCookiesFromBrowser);

export * from '../platform/oec-client.mjs';
export { default } from '../platform/oec-client.mjs';
