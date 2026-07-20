# 巨量引擎监控 — 开机自启动脚本
# 2026-07-15 自动生成
# 职责：启动 PM2 全家桶 + 启用 Windows 计划任务（仅5分钟/15分钟保活，日终任务由 shift-pusher 动态触发）

$logFile = "E:\炼丹炉\WorkBuddy\巨量引擎监控\monitor-data\startup.log"
$time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$time] 巨量引擎监控自启动开始..." | Out-File -FilePath $logFile -Encoding UTF8 -Append

try {
    # 启动 PM2 全家桶
    $pm2 = "C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2\pm2.cmd"
    $ecosystem = "E:\炼丹炉\WorkBuddy\巨量引擎监控\ecosystem.config.cjs"
    
    $result = & $pm2 start $ecosystem 2>&1
    "[$time] PM2 start: $result" | Out-File -FilePath $logFile -Encoding UTF8 -Append
    
    if ($LASTEXITCODE -ne 0) {
        $result2 = & $pm2 resurrect 2>&1
        "[$time] PM2 resurrect: $result2" | Out-File -FilePath $logFile -Encoding UTF8 -Append
    }

    # 启用 Windows 计划任务（仅保活用，日终任务由 shift-pusher 动态触发）
    schtasks /change /tn "巨量引擎5分钟速报" /enable 2>&1 | Out-File -FilePath $logFile -Encoding UTF8 -Append
    schtasks /change /tn "巨量引擎监控-15min" /enable 2>&1 | Out-File -FilePath $logFile -Encoding UTF8 -Append

    $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$time] 巨量引擎监控自启动完成" | Out-File -FilePath $logFile -Encoding UTF8 -Append
} catch {
    "[$time] 错误: $_" | Out-File -FilePath $logFile -Encoding UTF8 -Append
}
