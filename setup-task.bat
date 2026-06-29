@echo off
chcp 65001 >nul
title 巨量引擎监控 - 任务计划创建

echo ============================================
echo   巨量引擎监控 - 创建 Windows 任务计划
echo   运行时间: 每天 7:00-23:00，每15分钟一次
echo ============================================
echo.

:: 检查管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 请右键此文件 → 以管理员身份运行
    echo.
    pause
    exit /b 1
)

set NODE=C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2\node.exe
set SCRIPT=E:\炼丹炉\WorkBuddy\2026-06-11-08-56-59\oceanengine-scheduler.mjs
set TASK_NAME=巨量引擎监控-每15分钟

:: 先删掉旧的
schtasks /delete /tn "%TASK_NAME%" /f 2>nul

:: 创建新任务
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "\"%NODE%\" \"%SCRIPT%\"" ^
  /sc minute /mo 15 ^
  /st 07:00:00 ^
  /et 23:10:00 ^
  /f ^
  /rl HIGHEST

if %errorlevel% equ 0 (
    echo.
    echo [成功] 任务已创建！任务名称: %TASK_NAME%
    echo 下次触发: 到达下一个整15分钟 (如 21:00, 21:15...)
) else (
    echo.
    echo [失败] 创建任务时出错，请检查路径是否正确
)

pause
