@echo off\r
REM 巨量引擎监控启动脚本 - 设置环境后运行 monitor\r
setlocal\r
\r
REM 将 lark-cli 目录加入 PATH（findLarkCli 候选路径）\r
set "PATH=C:\Users\HTF2026\.workbuddy\binaries\node\cli-connector-packages;%PATH%"\r
\r
REM 使用 WorkBuddy 管理的 node.exe\r
set "NODE_EXE=C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2\node.exe"\r
\r
REM 脚本路径\r
set "SCRIPT=E:\炼丹炉\WorkBuddy\2026-06-11-08-56-59\oceanengine-monitor-v3.mjs"\r
\r
"%NODE_EXE%" "%SCRIPT%"\r
echo.\r
echo 按任意键退出...\r
pause >nul\r
endlocal\r
