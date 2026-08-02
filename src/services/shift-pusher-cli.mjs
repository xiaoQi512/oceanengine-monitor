// src/services/shift-pusher-cli.mjs - PM2/命令行启动入口
import { assertConfig } from '../config/index.mjs';
import { runCli } from './shift-pusher.mjs';

assertConfig();
runCli();
