$env:OEC_SILENT = "1"
$node = "C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2\node.exe"
$script = "E:\炼丹炉\WorkBuddy\巨量引擎监控\oceanengine-monitor-v3.mjs"
& $node $script
exit $LASTEXITCODE
