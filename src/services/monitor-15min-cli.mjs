// src/services/monitor-15min-cli.mjs - PM2/命令行启动入口
import { assertConfig } from '../config/index.mjs';
import { runCli } from './monitor-15min.mjs';

assertConfig();
runCli();
