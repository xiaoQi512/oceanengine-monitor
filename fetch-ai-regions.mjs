// AI区域号每日汇总数据拉取脚本
// 用法: node fetch-ai-regions.mjs
// 依次通过CDP Proxy打开5个AI账户报表，提取直播/短视频数据

const REPORT_IDS = {
  '东区': { aadvid: '1842681994872135', reportId: '299497419' },
  '西区': { aadvid: '1842681830951944', reportId: '299491275' },
  '中区': { aadvid: '1842663909080452', reportId: '298926513' },
  '南区': { aadvid: '1842682454270468', reportId: '299530471' },
  '北区': { aadvid: '1842683071403332', reportId: '299540674' }
};

const PROXY = 'http://localhost:3456';
const TODAY = new Date().toISOString().slice(0, 10); // 2026-06-26

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function openTab(url) {
  const res = await fetch(`${PROXY}/new`, {
    method: 'POST',
    body: url
  });
  const data = await res.json();
  return data.targetId;
}

async function evalScript(targetId, script) {
  const res = await fetch(`${PROXY}/eval?target=${targetId}`, {
    method: 'POST',
    body: script
  });
  const data = await res.json();
  if (!data.value) throw new Error('eval failed: ' + JSON.stringify(data));
  return JSON.parse(data.value);
}

async function closeTab(targetId) {
  await fetch(`${PROXY}/close?target=${targetId}`);
}

const EXTRACT_SCRIPT = `(() => {
  const tables = document.querySelectorAll("table.ovui-table");
  if (tables.length < 2) return JSON.stringify({error: "no data table", count: tables.length});
  const t = tables[1];
  let liveConsume = 0, liveLeads = 0, videoConsume = 0, videoLeads = 0;
  let matchedRows = 0;
  let allRows = [];
  for (let r = 0; r < t.rows.length; r++) {
    const cells = t.rows[r].cells;
    const time = (cells[0]?.innerText || "").trim();
    const scene = (cells[1]?.innerText || "").trim();
    const consume = parseFloat((cells[2]?.innerText || "0").replace(/,/g, "")) || 0;
    const leads = parseInt((cells[3]?.innerText || "0").replace(/,/g, "")) || 0;
    allRows.push({time: time.substring(0,30), scene, consume, leads});
    if (!time.includes("${TODAY}")) continue;
    matchedRows++;
    if (scene === "直播") { liveConsume += consume; liveLeads += leads; }
    else if (scene.includes("短视频") || scene.includes("图文")) { videoConsume += consume; videoLeads += leads; }
  }
  return JSON.stringify({
    liveConsume: liveConsume.toFixed(2),
    liveLeads,
    videoConsume: videoConsume.toFixed(2),
    videoLeads,
    matchedRows,
    totalRows: t.rows.length,
    sampleRows: allRows.slice(0, 3)
  });
})()`;

async function fetchRegion(name, config) {
  console.log(`\n[${name}] 开始拉取... aadvid=${config.aadvid}, reportId=${config.reportId}`);
  const url = `https://ad.oceanengine.com/statistics_pages/ad_report/customize/report/detail/${config.reportId}?aadvid=${config.aadvid}`;
  
  let targetId;
  try {
    targetId = await openTab(url);
    console.log(`[${name}] tab opened: ${targetId}`);
  } catch (e) {
    console.error(`[${name}] 打开tab失败: ${e.message}`);
    return { name, liveConsume: 0, liveLeads: 0, videoConsume: 0, videoLeads: 0, error: 'open failed' };
  }
  
  // 等待页面加载（最多30秒，每3秒检查一次）
  let data = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(3500);
    try {
      data = await evalScript(targetId, EXTRACT_SCRIPT);
      if (!data.error) {
        console.log(`[${name}] 数据获取成功:`, data);
        break;
      }
      console.log(`[${name}] 第${attempt+1}次尝试: ${data.error}`);
    } catch (e) {
      console.log(`[${name}] 第${attempt+1}次尝试异常: ${e.message}`);
    }
  }
  
  await closeTab(targetId);
  console.log(`[${name}] tab closed`);
  
  if (!data || data.error) {
    console.error(`[${name}] 数据拉取失败`);
    return { name, liveConsume: 0, liveLeads: 0, videoConsume: 0, videoLeads: 0, error: data?.error || 'unknown' };
  }
  
  return {
    name,
    liveConsume: parseFloat(data.liveConsume),
    liveLeads: data.liveLeads,
    videoConsume: parseFloat(data.videoConsume),
    videoLeads: data.videoLeads,
    matchedRows: data.matchedRows
  };
}

async function main() {
  console.log(`=== AI区域号每日汇总 ${TODAY} ===`);
  console.log(`目标日期: ${TODAY}`);
  
  const results = [];
  for (const [name, config] of Object.entries(REPORT_IDS)) {
    const result = await fetchRegion(name, config);
    results.push(result);
    await sleep(1000); // 区域间间隔
  }
  
  console.log('\n=== 汇总结果 ===');
  console.log(JSON.stringify(results, null, 2));
  
  // 输出到文件供后续处理
  const fs = await import('fs');
  fs.writeFileSync('ai-region-data.json', JSON.stringify(results, null, 2));
  console.log('\n数据已保存到 ai-region-data.json');
}

main().catch(e => {
  console.error('脚本执行失败:', e);
  process.exit(1);
});
