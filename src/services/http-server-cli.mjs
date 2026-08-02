// src/services/http-server-cli.mjs - PM2/命令行启动入口
import { assertConfig } from '../config/index.mjs';
import { startServer } from './http-server.mjs';

assertConfig();
startServer();
