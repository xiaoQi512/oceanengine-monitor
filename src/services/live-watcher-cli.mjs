// src/services/live-watcher-cli.mjs - PM2/命令行启动入口
import { assertConfig } from '../config/index.mjs';
import { runCli } from './live-watcher.mjs';

assertConfig();
runCli();
