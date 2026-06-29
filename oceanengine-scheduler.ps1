# ============================================================
# 巨量引擎 15分钟自动监控调度器
# 由 Windows 任务计划程序每15分钟触发一次
# 7:00-23:00 执行, 其余时间跳过
# ============================================================
param(
    [string]$ScriptPath = "E:\炼丹炉\WorkBuddy\2026-06-11-08-56-59\oceanengine-monitor-v3.mjs",
    [string]$NodeExe = "C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2\node.exe",
    [string]$WorkDir = "E:\炼丹炉\WorkBuddy\2026-06-11-08-56-59",
    [string]$LogFile = "E:\炼丹炉\WorkBuddy\2026-06-11-08-56-59\scheduler.log"
)

$now = Get-Date
$timeStr = $now.ToString('yyyy-MM-dd HH:mm:ss')

# ====== 1. 时间窗口检查 ======
$hour = $now.Hour
if ($hour -lt 7 -or $hour -ge 23) {
    # 非运行时段静默退出，不写日志避免刷屏
    exit 0
}

# ====== 2. Chrome 远程调试检查 ======
$chromeAlive = $false
try {
    $null = Invoke-WebRequest -Uri "http://localhost:9222/json/version" -UseBasicParsing -TimeoutSec 5
    $chromeAlive = $true
} catch {
    $chromeAlive = $false
}

if (-not $chromeAlive) {
    "$timeStr | ❌ Chrome 9222 端口未开启，跳过本次采集" | Add-Content -Path $LogFile -Encoding UTF8
    exit 1
}

# ====== 3. 检查巨量引擎页面是否在线 ======
try {
    $tabs = Invoke-RestMethod -Uri "http://localhost:9222/json/list" -UseBasicParsing -TimeoutSec 5
    $oeTab = $tabs | Where-Object { $_.title -eq "投放管理" -and $_.url -like "*oceanengine*" }
    if (-not $oeTab) {
        "$timeStr | ⚠ 投放管理页面未打开，跳过" | Add-Content -Path $LogFile -Encoding UTF8
        exit 1
    }
} catch {
    "$timeStr | ❌ 获取标签页失败: $_" | Add-Content -Path $LogFile -Encoding UTF8
    exit 1
}

# ====== 4. 执行监控脚本 ======
try {
    $output = & $NodeExe $ScriptPath 2>&1
    $summary = ($output | Select-String "监控摘要|告警数|总消耗|总转化|完成" | ForEach-Object { $_.Line }) -join " | "
    if ($summary.Length -gt 300) { $summary = $summary.Substring(0, 300) + "..." }
    "$timeStr | ✅ 完成 | $summary" | Add-Content -Path $LogFile -Encoding UTF8
} catch {
    "$timeStr | ❌ 脚本报错: $_" | Add-Content -Path $LogFile -Encoding UTF8
    exit 1
}

exit 0
