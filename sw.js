// sw.js — Service Worker (运行时缓存策略)
// 静态资源 dashboard-v4 + Chart.js 缓存优先
// API 请求网络优先

const CACHE_VERSION = 'oec-dash-v4';
const NETWORK_FIRST = ['/dashboard', '/dashboard-v4'];
const STATIC_ASSETS = [
  '/dashboard',
  '/dashboard-v4',
  '/vendor/chart.umd.min.js',
  '/manifest.json',
];

// ====== 安装：预缓存静态资源 ======
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      // 逐个添加，避免单个失败导致整体 reject
      await Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
      return self.skipWaiting();
    })
  );
});

// ====== 激活：清理旧缓存 ======
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ====== 请求拦截 ======
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 仅处理 GET
  if (req.method !== 'GET') return;

  // API 请求：网络优先，不缓存
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req).catch(() => new Response('{"error":"offline"}', {
      headers: { 'Content-Type': 'application/json' },
    })));
    return;
  }

  // 同源静态资源 & 本地 vendor
  // - dashboard-v4: 网络优先
  // - manifest: 缓存优先 + 后台更新
  const isNetworkFirst = NETWORK_FIRST.includes(url.pathname);
  const isStaticCache = url.pathname === '/manifest.json';

  if (isNetworkFirst) {
    event.respondWith(
      fetch(req).then(resp => {
        if (resp && resp.ok) {
          caches.open(CACHE_VERSION).then(c => c.put(req, resp.clone()));
        }
        return resp;
      }).catch(() => caches.match(req).then(c => c || new Response('离线', { status: 503 })))
    );
    return;
  }

  if (isStaticCache) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) {
          fetch(req).then(resp => {
            if (resp && resp.ok) {
              caches.open(CACHE_VERSION).then(c => c.put(req, resp.clone()));
            }
          }).catch(() => {});
          return cached;
        }
        return fetch(req).then(resp => {
          if (resp && resp.ok) {
            caches.open(CACHE_VERSION).then(c => c.put(req, resp.clone()));
          }
          return resp;
        });
      })
    );
    return;
  }

  // 其他同源请求：直通网络
});

// ====== 消息：允许页面主动触发更新 ======
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
