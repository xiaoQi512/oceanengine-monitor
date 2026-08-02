// src/services/feishu-listener-cli.mjs - PM2/命令行启动入口
import { assertConfig } from '../config/index.mjs';
import { runCli } from './feishu-listener.mjs';

assertConfig();
runCli();
