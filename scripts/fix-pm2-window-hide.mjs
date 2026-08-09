// Reapplies a local PM2 fix on Windows so its 30s metric collector does not flash a console.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const nodeExe =
  process.env.NODE_EXE ||
  'C:\\Users\\HTF2026\\.workbuddy\\binaries\\node\\versions\\22.22.2\\node.exe';
const pm2Cli =
  process.env.PM2_CLI ||
  'C:\\Users\\HTF2026\\.workbuddy\\binaries\\node\\versions\\22.22.2\\node_modules\\pm2\\bin\\pm2';
const gwmiFile =
  'C:\\Users\\HTF2026\\.workbuddy\\binaries\\node\\versions\\22.22.2\\node_modules\\pm2\\node_modules\\pidusage\\lib\\gwmi.js';

function runPm2(args) {
  const result = spawnSync(nodeExe, [pm2Cli, ...args], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

let content = readFileSync(gwmiFile, 'utf8');

if (content.includes('-WindowStyle')) {
  console.log('[pm2-fix] gwmi.js already patched');
} else {
  const pattern =
    /const args = \['win32_process'[\s\S]*?bin\('gwmi', args, \{ windowsHide: true, windowsVerbatimArguments: true, shell: 'powershell\.exe' \}, function \(err, stdout, code\) \{/;

  if (!pattern.test(content)) {
    throw new Error('[pm2-fix] gwmi.js pattern not found');
  }

  const replacement = [
    "const args = [",
    "    '-NoProfile',",
    "    '-NonInteractive',",
    "    '-WindowStyle',",
    "    'Hidden',",
    "    '-Command',",
    "    `gwmi win32_process -Filter '${whereClause}' | select ${property} | format-table`",
    "  ]",
    "",
    "  bin('powershell.exe', args, { windowsHide: true, windowsVerbatimArguments: true }, function (err, stdout, code) {",
  ].join('\n');

  writeFileSync(gwmiFile, content.replace(pattern, replacement), 'utf8');
  console.log('[pm2-fix] gwmi.js patched');
}

runPm2(['set', 'pm2:sysmonit', 'false']);
runPm2(['update']);
console.log('[pm2-fix] done');
