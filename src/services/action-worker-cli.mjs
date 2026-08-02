// src/services/action-worker-cli.mjs - PM2/命令行启动入口
import { assertConfig } from '../config/index.mjs';
import { runCli } from './action-worker.mjs';

assertConfig();
runCli();
