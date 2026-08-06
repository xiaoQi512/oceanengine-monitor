# Oceanengine monitor startup fallback script.
# 2026-08-06: run PM2 hidden with timeout instead of blocking on pm2.cmd.
# PM2 registry startup is the primary boot path; this script is a manual fallback.

$logDir = Join-Path $PSScriptRoot 'monitor-data'
$logFile = Join-Path $logDir 'startup.log'
$nodeExe = 'C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2\node.exe'
$pm2Cli = 'C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2\node_modules\pm2\bin\pm2'
$ecosystem = Join-Path $PSScriptRoot 'ecosystem.config.cjs'
$pm2TimeoutMs = 120000

function Write-StartupLog($message) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "[$ts] $message" | Out-File -FilePath $logFile -Encoding UTF8 -Append
}

function Invoke-Pm2Hidden {
    param(
        [string[]]$Arguments,
        [string]$Action
    )

    $stdout = Join-Path $logDir "startup-pm2-$Action.out.log"
    $stderr = Join-Path $logDir "startup-pm2-$Action.err.log"
    $pm2Args = @($pm2Cli)
    $pm2Args += $Arguments
    $argText = ($pm2Args | ForEach-Object { '"' + $_ + '"' }) -join ' '

    try {
        $process = Start-Process -FilePath $nodeExe -ArgumentList $argText -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        if (-not $process.WaitForExit($pm2TimeoutMs)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            Write-StartupLog "PM2 $Action timeout (${pm2TimeoutMs}ms), hidden CLI cleaned"
            return $false
        }

        if ($process.ExitCode -ne 0) {
            Write-StartupLog "PM2 $Action exit code: $($process.ExitCode)"
            return $false
        }

        $summary = ''
        if (Test-Path $stdout) {
            $summary = (Get-Content -LiteralPath $stdout -Raw).Trim()
        }
        if ($summary.Length -gt 2000) {
            $summary = $summary.Substring(0, 2000) + '...'
        }
        Write-StartupLog "PM2 $Action OK: $summary"
        return $true
    } catch {
        Write-StartupLog "PM2 $Action failed: $_"
        return $false
    }
}

try {
    Write-StartupLog 'Oceanengine monitor startup begin...'
    $ok = Invoke-Pm2Hidden -Arguments @('start', $ecosystem) -Action 'start'
    if (-not $ok) {
        Write-StartupLog 'PM2 start failed, trying resurrect'
        $null = Invoke-Pm2Hidden -Arguments @('resurrect') -Action 'resurrect'
    }
    Write-StartupLog 'Oceanengine monitor startup done'
} catch {
    Write-StartupLog "Error: $_"
}
