' 静默运行 日报调度，无窗口
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2\node.exe"" ""E:\炼丹炉\WorkBuddy\巨量引擎监控\oceanengine-daily-report-scheduler.mjs""", 0, True
