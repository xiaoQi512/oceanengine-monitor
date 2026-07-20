import { createClient, getProjects } from './oceanengine-api-client.mjs';

const client = await createClient({ useCache: true });
const allProjects = [];
for (let p = 1; p <= 5; p++) {
  const r = await getProjects(client, { page: p, pageSize: 50 });
  if (!r || !r.projects || !r.projects.length) break;
  allProjects.push(...r.projects);
}
console.log('总项目数: ' + allProjects.length);
const groups = {};
for (const proj of allProjects) {
  const goal = proj.marketing_goal || proj.campaign_type || '(无)';
  if (!groups[goal]) groups[goal] = { count: 0, spend: 0 };
  groups[goal].count++;
  const sc = parseFloat(String(proj.stat_cost || 0).replace(/,/g, '')) || 0;
  groups[goal].spend += sc;
}
console.log('\n按 marketing_goal 分组:');
for (const g of Object.keys(groups)) {
  const info = groups[g];
  console.log('  ' + g + ': ' + info.count + ' 个 | 消耗 ¥' + info.spend.toFixed(2));
}
if (allProjects[0]) {
  console.log('\n首项目字段: ' + Object.keys(allProjects[0]).join(', '));
  // 看前3个项目的 marketing_goal / campaign_type 字段
  console.log('\n前3项目关键字段:');
  for (let i = 0; i < Math.min(3, allProjects.length); i++) {
    const p = allProjects[i];
    console.log('  #' + (i+1) + ' name=' + (p.name||p.project_name||'?').substring(0,30) + ' | marketing_goal=' + p.marketing_goal + ' | campaign_type=' + p.campaign_type + ' | status=' + p.status);
  }
}
