import { readFileSync, writeFileSync } from "fs";
let c = readFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", "utf-8");

// Find all acknowledgeStart occurrences
let pos = 0;
let occurrences = [];
while (true) {
  const idx = c.indexOf("function acknowledgeStart", pos);
  if (idx === -1) break;
  occurrences.push(idx);
  pos = idx + 1;
}
console.log("acknowledgeStart occurrences:", occurrences.length, "at", occurrences);

// If there are 2, remove the first one (the old one without chatId)
if (occurrences.length === 2) {
  // Find the old function boundaries
  const oldStart = occurrences[0];
  // Count braces to find end
  const oldBodyStart = c.indexOf("{", oldStart);
  let bc = 1;
  let oldEnd = oldBodyStart + 1;
  for (; oldEnd < c.length && bc > 0; oldEnd++) {
    if (c[oldEnd] === "{") bc++;
    else if (c[oldEnd] === "}") bc--;
  }
  console.log("Removing old acknowledgeStart from", oldStart, "to", oldEnd);
  // Include the leading newline
  const prevNl = c.lastIndexOf("\n", oldStart);
  c = c.slice(0, prevNl + 1) + c.slice(oldEnd);
}

// Same for reportResult
pos = 0;
occurrences = [];
while (true) {
  const idx = c.indexOf("function reportResult", pos);
  if (idx === -1) break;
  occurrences.push(idx);
  pos = idx + 1;
}
console.log("reportResult occurrences:", occurrences.length);

if (occurrences.length === 2) {
  const oldStart = occurrences[0];
  const oldBodyStart = c.indexOf("{", oldStart);
  let bc = 1;
  let oldEnd = oldBodyStart + 1;
  for (; oldEnd < c.length && bc > 0; oldEnd++) {
    if (c[oldEnd] === "{") bc++;
    else if (c[oldEnd] === "}") bc--;
  }
  console.log("Removing old reportResult from", oldStart, "to", oldEnd);
  const prevNl = c.lastIndexOf("\n", oldStart);
  c = c.slice(0, prevNl + 1) + c.slice(oldEnd);
}

writeFileSync("E:\\炼丹炉\\WorkBuddy\\巨量引擎监控\\feishu-listener.mjs", c, "utf-8");
console.log("Fixed duplicate functions");
