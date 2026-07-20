<#
.SYNOPSIS
  巨量引擎监控系统守护程序 — 五层自愈防护
.DESCRIPTION
  Layer 1: 进程守护 (Node/Chrome/端口)
  Layer 2: 数据新鲜度 (5min快照/15min快照)
  Layer 3: 依赖完整性 (node_modules)
  Layer 4: 代码一致性 (Node --check)
  Layer 5: 自守护 (心跳文件)
.PARAMETER Mode
  daemon : 持续循环监控 (Task Scheduler 每 60s 触发)
  once   : 单次检查 (手动调试)
  install: 安装到 Windows Task Scheduler
.EXAMPLE
  .\watchdog.ps1 once      # 手动运行一次检查
  .\watchdog.ps1 daemon    # 持续循环
  .\watchdog.ps1 install   # 安装计划任务
#>

param(
    [ValidateSet("daemon","once","install")]
    [string]$Mode = "once"
)

$ErrorActionPreference = "Continue"
$MONITOR_DIR = "E:\炼丹炉\WorkBuddy\巨量引擎监控"
$DATA_DIR = "$MONITOR_DIR\monitor-data"
$NODE = "C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2\node.exe"
$HEARTBEAT_FILE = "$DATA_DIR\watchdog-heartbeat.txt"
$ALERT_LOG = "$DATA_DIR\watchdog-alerts.jsonl"
$CHAT_ID = "oc_8deeb3061bdbd43608de252a44c97a25"

# ====== 阈值配置 ======
$MIN_NODE_PROCS = 3          # 最少 Node 进程数
$DATA_GAP_CRITICAL_MIN = 12  # 12 分钟无新数据 → 严重
$DATA_GAP_WARN_MIN = 7       # 7 分钟无新数据 → 警告
$DEP_CHECK_INTERVAL_MIN = 30 # 依赖检查间隔(分钟)
$SELF_HEAL_COOLDOWN_MIN = 5  # 自愈冷却时间(分钟)
$LOOP_SLEEP_SEC = 30         # daemon 模式循环间隔

# ====== 状态文件 ======
$STATE_FILE = "$DATA_DIR\watchdog-state.json"

# ====== 工具函数 ======
function Write-Log($msg, $color = "White") {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $msg"
    Write-Host $line -ForegroundColor $color
    try { Add-Content -Path "$DATA_DIR\watchdog.log" -Value $line -Encoding UTF8 } catch {}
}

function Write-Alert($type, $detail, $action) {
    $entry = @{
        time = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
        type = $type
        detail = $detail
        action = $action
    } | ConvertTo-Json -Compress
    try { Add-Content -Path $ALERT_LOG -Value $entry -Encoding UTF8 } catch {}
    Write-Log "[ALERT] $type : $detail → $action" "Red"
}

function Send-FeishuAlert($title, $body) {
    $lark = Get-Command lark-cli -ErrorAction SilentlyContinue
    if (-not $lark) {
        $lark = Get-Command lark-cli.exe -ErrorAction SilentlyContinue
    }
    if (-not $lark) {
        Write-Log "[WARN] lark-cli not found, alert not sent" "Yellow"
        return
    }
    $text = "$title`n$body"
    $content = (@{ text = $text } | ConvertTo-Json -Compress)
    try {
        & $lark.Source im +messages-send --chat-id $CHAT_ID --msg-type text --content $content 2>$null
    } catch {
        Write-Log "[WARN] Feishu send failed: $_" "Yellow"
    }
}

function Load-State {
    if (Test-Path $STATE_FILE) {
        try { return Get-Content $STATE_FILE -Raw | ConvertFrom-Json }
        catch { return @{} }
    }
    return @{}
}

function Save-State($state) {
    try { $state | ConvertTo-Json | Set-Content $STATE_FILE -Encoding UTF8 } catch {}
}

# ====== Layer 1: 进程守护 ======
function Test-Layer1 {
    $issues = @()
    $now = Get-Date

    # 1a. Node 进程数
    $nodeCount = (Get-Process -Name "node" -ErrorAction SilentlyContinue | Measure-Object).Count
    if ($nodeCount -lt $MIN_NODE_PROCS) {
        $issues += "Node进程仅 $nodeCount 个(阈值 $MIN_NODE_PROCS)"
    } else {
        Write-Log "[L1 OK] Node: $nodeCount 进程" "Green"
    }

    # 1b. 端口检查
    $ports = @{
        8899 = "feedback-server"
        9222 = "Chrome CDP"
    }
    $allPorts = netstat -ano 2>$null | Out-String
    foreach ($port in $ports.Keys) {
        if ($allPorts -match ":$port .*LISTENING") {
            Write-Log "[L1 OK] $($ports[$port]):$port" "Green"
        } else {
            $issues += "端口 $port ($($ports[$port])) 未监听"
        }
    }

    # 1c. Chrome 进程
    $chromeCount = (Get-Process -Name "chrome" -ErrorAction SilentlyContinue | Measure-Object).Count
    if ($chromeCount -eq 0) {
        $issues += "Chrome 未运行"
    } else {
        Write-Log "[L1 OK] Chrome: $chromeCount 进程" "Green"
    }

    return $issues
}

# ====== Layer 2: 数据新鲜度 ======
function Test-Layer2 {
    $issues = @()

    # 2a. 5min 快照
    $latest5m = Get-ChildItem "$DATA_DIR\5m-*.json" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest5m) {
        $ageMin = [math]::Round(((Get-Date) - $latest5m.LastWriteTime).TotalMinutes, 1)
        if ($ageMin -gt $DATA_GAP_CRITICAL_MIN) {
            $issues += "5min快照 $ageMin 分钟无更新(严重)"
        } elseif ($ageMin -gt $DATA_GAP_WARN_MIN) {
            $issues += "5min快照 $ageMin 分钟无更新(警告)"
        } else {
            Write-Log "[L2 OK] 5min: $ageMin 分钟前" "Green"
        }
    } else {
        $issues += "5min快照目录为空"
    }

    # 2b. 15min 快照
    $pattern = "^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$"
    $latest15m = Get-ChildItem "$DATA_DIR\*.json" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match $pattern } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest15m) {
        $ageMin = [math]::Round(((Get-Date) - $latest15m.LastWriteTime).TotalMinutes, 1)
        if ($ageMin -gt 25) {
            $issues += "15min快照 $ageMin 分钟无更新"
        } else {
            Write-Log "[L2 OK] 15min: $ageMin 分钟前" "Green"
        }
    }

    return $issues
}

# ====== Layer 3: 依赖完整性 ======
function Test-Layer3 {
    $state = Load-State
    $now = Get-Date

    # 冷却期检查
    if ($state.lastDepCheck) {
        $lastCheck = [datetime]::Parse($state.lastDepCheck)
        if (($now - $lastCheck).TotalMinutes -lt $DEP_CHECK_INTERVAL_MIN) {
            Write-Log "[L3] 冷却中 ($([math]::Round(($now-$lastCheck).TotalMinutes,1))min/$($DEP_CHECK_INTERVAL_MIN)min)" "DarkGray"
            return @()
        }
    }

    $issues = @()
    $modules = @("ws", "better-sqlite3", "jszip", "pptxgenjs")
    foreach ($mod in $modules) {
        $path = "$MONITOR_DIR\node_modules\$mod"
        if (-not (Test-Path $path)) {
            $issues += "node_modules/$mod 缺失"
        }
    }

    $state.lastDepCheck = $now.ToString("o")
    Save-State $state

    if ($issues.Count -eq 0) {
        Write-Log "[L3 OK] 依赖完整 ($($modules.Count) 模块)" "Green"
    }
    return $issues
}

# ====== Layer 4: 代码一致性 ======
function Test-Layer4 {
    $issues = @()
    $files = @(
        "$MONITOR_DIR\oceanengine-monitor-v3.mjs",
        "$MONITOR_DIR\oceanengine-5min-check.mjs",
        "$MONITOR_DIR\oceanengine-api-client.mjs",
        "$MONITOR_DIR\feedback-server.mjs"
    )

    foreach ($f in $files) {
        if (-not (Test-Path $f)) { continue }
        $result = & $NODE --check $f 2>&1
        if ($LASTEXITCODE -ne 0) {
            $short = ($result -join " ").Substring(0, [Math]::Min(100, ($result -join " ").Length))
            $issues += "$(Split-Path $f -Leaf): $short"
        }
    }

    if ($issues.Count -eq 0) {
        Write-Log "[L4 OK] 代码语法检查通过" "Green"
    }
    return $issues
}

# ====== Layer 5: 自守护(心跳) ======
function Update-Heartbeat {
    try { Get-Date -Format "o" | Set-Content $HEARTBEAT_FILE -Encoding UTF8 } catch {}
}

# ====== 自愈引擎 ======
function Invoke-SelfHeal($issues, $state) {
    $now = Get-Date

    # 冷却检查: 5分钟内不自愈两次
    if ($state.lastHeal) {
        $lastHeal = [datetime]::Parse($state.lastHeal)
        if (($now - $lastHeal).TotalMinutes -lt $SELF_HEAL_COOLDOWN_MIN) {
            Write-Log "[HEAL] 冷却中，跳过自愈" "DarkGray"
            return
        }
    }

    Write-Log "[HEAL] 开始自愈流程，发现问题: $($issues.Count) 个" "Yellow"

    foreach ($issue in $issues) {
        Write-Log "  - $issue" "DarkGray"

        # 进程类问题: 重拉 Chrome
        if ($issue -match "Chrome|9222") {
            Write-Log "  → 尝试拉起 Chrome..." "Yellow"
            $chromeExe = @(
                "C:\Program Files\Google\Chrome\Application\chrome.exe",
                "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
            ) | Where-Object { Test-Path $_ } | Select-Object -First 1
            if ($chromeExe) {
                Start-Process $chromeExe -ArgumentList "--remote-debugging-port=9222","--no-first-run","--no-default-browser-check" -WindowStyle Hidden
                Start-Sleep 5
            }
        }

        # 端口类问题: 重拉 Node 服务
        if ($issue -match "feedback-server|8899") {
            Write-Log "  → 尝试重拉 feedback-server..." "Yellow"
            $cwd = $MONITOR_DIR
            Start-Process $NODE -ArgumentList "feedback-server.mjs" -WorkingDirectory $cwd -WindowStyle Hidden
            Start-Sleep 3
        }

        # 依赖类问题: npm install
        if ($issue -match "node_modules.*缺失") {
            Write-Log "  → 尝试 npm install..." "Yellow"
            $npm = "C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2\npm.cmd"
            if (Test-Path $npm) {
                & $npm --prefix "$MONITOR_DIR" install 2>&1 | Out-Null
                Write-Log "  npm install 完成" "Green"
            }
        }

        # 数据断层: 强制触发采集
        if ($issue -match "快照.*无更新|为空") {
            Write-Log "  → 强制触发 5min 采集..." "Yellow"
            Start-Process $NODE -ArgumentList "oceanengine-5min-check.mjs" -WorkingDirectory $MONITOR_DIR -WindowStyle Hidden
            Start-Sleep 10
        }
    }

    $state.lastHeal = $now.ToString("o")
    Save-State $state

    # 飞书告警
    $body = ($issues -join "`n")
    Send-FeishuAlert "🔧 巨量引擎监控 自愈触发" $body
}

# ====== 主循环 ======
function Invoke-Watchdog {
    param([bool]$Loop = $false)

    do {
        Update-Heartbeat
        $state = Load-State
        $allIssues = @()

        Write-Log "=== 守护检查 $(Get-Date -Format 'HH:mm:ss') ===" "Cyan"
        $allIssues += Test-Layer1
        $allIssues += Test-Layer2
        $allIssues += Test-Layer3
        $allIssues += Test-Layer4

        if ($allIssues.Count -gt 0) {
            Write-Log "发现 $($allIssues.Count) 个问题:" "Red"
            foreach ($i in $allIssues) {
                Write-Log "  ❌ $i" "Red"
                Write-Alert "watchdog" $i "pending"
            }
            Invoke-SelfHeal $allIssues $state
        } else {
            Write-Log "✅ 全部正常" "Green"
        }

        if ($Loop) { Start-Sleep $LOOP_SLEEP_SEC }
    } while ($Loop)
}

# ====== 安装计划任务 ======
function Install-ScheduledTask {
    $scriptPath = (Resolve-Path $PSCommandPath).Path
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" daemon"
    $trigger = New-ScheduledTaskTrigger -AtStartup -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 365)
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Seconds 30)
    Register-ScheduledTask -TaskName "OEC-Monitor-Watchdog" -Action $action -Trigger $trigger -Settings $settings -Description "巨量引擎监控守护程序" -Force
    Write-Log "[INSTALL] 计划任务已创建: OEC-Monitor-Watchdog" "Green"
    Write-Log "[INSTALL] 脚本路径: $scriptPath" "Green"
}

# ====== 入口 ======
switch ($Mode) {
    "once"    { Invoke-Watchdog -Loop:$false }
    "daemon"  {
        Write-Log "🚀 守护程序启动 (daemon 模式, 间隔 ${LOOP_SLEEP_SEC}s)" "Cyan"
        Invoke-Watchdog -Loop:$true
    }
    "install" { Install-ScheduledTask }
}