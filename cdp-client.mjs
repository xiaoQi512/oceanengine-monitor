// cdp-client.mjs — 统一CDP客户端模块
// 提供带重连、心跳、超时、退避重试的鲁棒Chrome DevTools Protocol连接
// 供 oceanengine-monitor-v3 / 5min-check / calibrate-page / action-executor 共用

import WebSocket from 'ws';
import http from 'node:http';

const CDP_LIST_URL = 'http://localhost:9222/json/list';
const CDP_VERSION_URL = 'http://localhost:9222/json/version';

// ====== 配置常量 ======
const DEFAULT_CMD_TIMEOUT = 30000;    // 命令执行超时 (ms)
const HEARTBEAT_INTERVAL = 30000;     // 心跳间隔 (ms)
const HEARTBEAT_TIMEOUT = 10000;      // 心跳超时 (ms)
const MAX_RECONNECT_RETRIES = 3;      // 最大重连次数
const RECONNECT_BASE_DELAY = 2000;    // 重连基础延迟 (ms)

/**
 * 检查 Chrome CDP 是否可达
 * @returns {Promise<{reachable: boolean, browser?: string, wsUrl?: string}>}
 */
export async function checkCDP() {
  return new Promise((resolve) => {
    const req = http.get(CDP_VERSION_URL, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ reachable: true, browser: json.Browser || 'unknown', wsUrl: json.webSocketDebuggerUrl || '' });
        } catch {
          resolve({ reachable: false });
        }
      });
    });
    req.on('error', () => resolve({ reachable: false }));
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false }); });
  });
}

/**
 * 获取巨量引擎标签页
 * @param {string|string[]} titlePattern - 标题匹配模式
 * @returns {Promise<object|null>} 标签页信息
 */
export async function getOceanEngineTab(titlePattern) {
  try {
    const resp = await fetch(CDP_LIST_URL);
    const tabs = await resp.json();
    if (!Array.isArray(tabs) || tabs.length === 0) return null;

    const patterns = Array.isArray(titlePattern) ? titlePattern : [titlePattern].filter(Boolean);

    // 精确匹配
    for (const pat of patterns) {
      const found = tabs.find(t => t.title?.includes(pat));
      if (found) return found;
    }

    // URL 匹配
    const byUrl = tabs.find(t => t.url?.includes('oceanengine.com'));
    if (byUrl) return byUrl;

    // 最后一个page类型标签页
    const lastPage = [...tabs].reverse().find(t => t.type === 'page');
    return lastPage || null;
  } catch (e) {
    console.error(`  [CDP] 获取标签页失败: ${e.message}`);
    return null;
  }
}

/**
 * 创建CDP客户端
 * @param {string} wsAddress - WebSocket 地址
 * @param {object} options
 * @param {number} [options.cmdTimeout=30000] - 命令超时
 * @param {number} [options.heartbeatInterval=30000] - 心跳间隔
 * @param {boolean} [options.verbose=false] - 详细日志
 * @returns {Promise<CDPClient>}
 */
export async function createCDPClient(wsAddress, options = {}) {
  const cmdTimeout = options.cmdTimeout || DEFAULT_CMD_TIMEOUT;
  const hbInterval = options.heartbeatInterval || HEARTBEAT_INTERVAL;
  const verbose = options.verbose || false;

  const log = (...args) => { if (verbose) console.log('[CDP]', ...args); };

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsAddress);
    let cmdId = 1;
    const pending = new Map();       // id -> { resolve, timer }
    let heartbeatTimer = null;
    let isClosed = false;
    let closeReason = null;

    // 清理所有待处理命令
    function clearPending(reason) {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve({ error: reason || 'connection_closed', id });
      }
      pending.clear();
    }

    // 启动心跳
    function startHeartbeat() {
      stopHeartbeat();
      heartbeatTimer = setInterval(async () => {
        if (isClosed) return;
        try {
          const r = await rawSend('Runtime.evaluate', {
            expression: '1+1',
            returnByValue: true,
            silent: true,
          }, HEARTBEAT_TIMEOUT);
          if (r && r.error) {
            log('心跳失败，连接已断开:', r.error);
            handleClose('heartbeat_failed');
          }
        } catch (e) {
          // 心跳发送失败(ws.send异常) -> 连接已断
          log('心跳发送异常:', e.message);
          handleClose('heartbeat_send_failed');
        }
      }, hbInterval);
    }

    function stopHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function handleClose(reason) {
      if (isClosed) return;
      isClosed = true;
      closeReason = reason;
      stopHeartbeat();
      clearPending(reason);
      try { ws.close(); } catch {}
    }

    // 原始发送（不走 pending 队列，用于心跳等内部命令）
    // 独立命令ID空间: 负值
    let rawId = 0;
    function rawSend(method, params = {}, timeoutMs = HEARTBEAT_TIMEOUT) {
      return new Promise((resolve) => {
        if (isClosed) { resolve({ error: 'closed' }); return; }
        const id = --rawId;
        const timer = setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); resolve({ error: 'timeout' }); }
        }, timeoutMs);
        pending.set(id, { resolve, timer });
        try {
          ws.send(JSON.stringify({ id, method, params }));
        } catch (e) {
          clearTimeout(timer);
          pending.delete(id);
          resolve({ error: e.message });
        }
      });
    }

    // === WebSocket 事件 ===
    ws.once('open', () => {
      log('CDP连接已建立');
      startHeartbeat();

      // 开启必要域
      const initPromises = [
        rawSend('Page.enable', {}),
        rawSend('Runtime.enable', {}),
      ];

      Promise.all(initPromises).then(() => {
        log('Page/Runtime 域已启用');

        // 构建 send 方法
        const send = (method, params = {}, timeoutMs = cmdTimeout) => {
          return new Promise((resolve) => {
            if (isClosed) {
              resolve({ error: closeReason || 'closed', method });
              return;
            }
            const id = cmdId++;
            const timer = setTimeout(() => {
              if (pending.has(id)) {
                pending.delete(id);
                resolve({ error: 'timeout', id, method });
              }
            }, timeoutMs);
            pending.set(id, { resolve, timer });
            try {
              ws.send(JSON.stringify({ id, method, params }));
            } catch (e) {
              clearTimeout(timer);
              pending.delete(id);
              resolve({ error: e.message, id, method });
            }
          });
        };

        // 简化版调用: client.call('Method.name', params) -> result 或 null
        const call = async (method, params = {}, timeoutMs = cmdTimeout) => {
          const r = await send(method, params, timeoutMs);
          if (r && !r.error) return r.result || r;
          if (r && r.error) log(`CDP调用失败 [${method}]: ${r.error}`);
          return null;
        };

        // evalJs: 在页面中执行JS表达式并返回value
        const evalJs = async (expression, opts = {}) => {
          const r = await send('Runtime.evaluate', {
            expression,
            returnByValue: opts.returnByValue !== false,
            awaitPromise: opts.awaitPromise || false,
          }, opts.timeoutMs || cmdTimeout);
          return r?.result?.result?.value;
        };

        // 截图
        const screenshot = async () => {
          const r = await send('Page.captureScreenshot', { format: 'png' });
          return r?.result?.data || null;
        };

        const client = {
          ws,
          send,
          call,
          evalJs,
          screenshot,
          close: () => {
            handleClose('user_close');
          },
          get isAlive() { return !isClosed; },
          get closeReason() { return closeReason; },
        };

        resolve(client);
      }).catch(e => {
        // Page/Runtime.enable 失败 = 连接不可用
        stopHeartbeat();
        clearPending('init_failed');
        try { ws.close(); } catch {}
        reject(new Error(`CDP初始化失败: ${e.message || e}`));
      });
    });

    ws.once('error', (e) => {
      stopHeartbeat();
      clearPending(e.message);
      reject(e);
    });

    ws.on('message', (data) => {
      const d = Buffer.isBuffer(data) ? data.toString() : String(data || '');
      let msg;
      try { msg = JSON.parse(d); } catch { return; }

      // 处理CDP事件 (没有id的消息)
      if (msg.method) {
        // 控制台消息 -> 静默
        if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Log.entryAdded') return;
        // 页面导航事件
        if (msg.method === 'Page.frameNavigated' || msg.method === 'Page.loadEventFired') return;
        // 其他事件 -> debug日志
        // log('CDP事件:', msg.method);
        return;
      }

      if (msg.id && pending.has(msg.id)) {
        const { resolve, timer } = pending.get(msg.id);
        clearTimeout(timer);
        pending.delete(msg.id);

        if (msg.error) {
          resolve({ error: msg.error.message || JSON.stringify(msg.error), id: msg.id });
        } else {
          resolve(msg);
        }
      }
    });

    ws.once('close', (code, reason) => {
      const r = reason?.toString() || `code=${code}`;
      if (!isClosed) {
        handleClose(r);
      }
    });

    // 连接超时
    setTimeout(() => {
      if (!isClosed && pending.size > 0 && pending.has(-1)) {
        // 初始化未完成
        handleClose('connect_timeout');
        reject(new Error('CDP连接初始化超时'));
      }
    }, 15000);
  });
}

/**
 * 快捷连接: 自动找到巨量引擎Tab并连接
 * @param {object} options - createCDPClient options
 * @returns {Promise<{client: CDPClient, tab: object}|null>}
 */
export async function quickConnect(options = {}) {
  const tab = await getOceanEngineTab(['投放管理', '巨量引擎工作台']);
  if (!tab) {
    console.error('  ❌ 未找到巨量引擎标签页');
    return null;
  }

  try {
    const client = await createCDPClient(tab.webSocketDebuggerUrl, options);
    console.log(`  ✅ CDP已连接: ${tab.title?.substring(0, 60)}`);
    return { client, tab };
  } catch (e) {
    console.error(`  ❌ CDP连接失败: ${e.message}`);
    return null;
  }
}

/**
 * 带重试的连接
 * @param {object} options
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.retryDelay=2000]
 * @returns {Promise<{client: CDPClient, tab: object}|null>}
 */
export async function quickConnectWithRetry(options = {}) {
  const maxRetries = options.maxRetries || MAX_RECONNECT_RETRIES;
  const baseDelay = options.retryDelay || RECONNECT_BASE_DELAY;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelay * Math.pow(2, attempt - 1); // 指数退避
      console.log(`  🔄 重试连接 (${attempt + 1}/${maxRetries}), 等待${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }

    // 每次重试前检查CDP是否可达
    if (attempt > 0) {
      const alive = await checkCDP();
      if (!alive.reachable) {
        console.log(`  ⚠ CDP不可达 (重试${attempt + 1})，继续等待...`);
        continue;
      }
    }

    const result = await quickConnect(options);
    if (result) return result;
  }

  console.error(`  ❌ ${maxRetries}次重试后仍无法连接`);
  return null;
}

export default {
  checkCDP,
  getOceanEngineTab,
  createCDPClient,
  quickConnect,
  quickConnectWithRetry,
  CDP_LIST_URL,
  CDP_VERSION_URL,
};
