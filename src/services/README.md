# src/services

本目录存放 PM2 进程级编排入口，职责是启动、调度和生命周期管理，不写业务算法。

已迁移：

- `feishu-listener.mjs`：飞书群消息监听与反馈闭环
- `action-worker.mjs`：操作队列串行 Worker
- `live-watcher.mjs`：直播间状态轮询
- `shift-pusher.mjs`：主播换班数据推送
- `http-server.mjs`：8899 HTTP / Dashboard / REST API 服务
- `http-routes/`：HTTP 路由模块（static / snapshots / campaigns / alerts / live / accounts）
- `cron-*.mjs`：日报、日汇总、排班同步、AI 区域号等定时任务入口
- `monitor-5min.mjs`：5 分钟监控采集与速报入口
- `monitor-15min.mjs`：15 分钟完整监控入口

根目录同名 `.mjs` 保留兼容入口；PM2 已切换为直接使用本目录脚本。

每个服务同时提供 `-cli.mjs` 启动入口；普通模块导入不会启动常驻逻辑。
