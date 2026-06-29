' 静默运行 5分钟速报，无窗口
Set WshShell = CreateObject("WScript.Shell")
Set Env = WshShell.Environment("Process")
Env("OEC_SILENT") = "1"
WshShell.Run """C:\Users\HTF2026\.workbuddy\binaries\node\versions\22.22.2\node.exe"" ""E:\炼丹炉\WorkBuddy\巨量引擎监控\oceanengine-5min-check.mjs""", 0, True
