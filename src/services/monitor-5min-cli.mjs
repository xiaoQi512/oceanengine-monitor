// src/services/monitor-5min-cli.mjs - PM2/命令行启动入口
import { assertConfig } from '../config/index.mjs';
import { runCli } from './monitor-5min.mjs';

assertConfig();
runCli();
