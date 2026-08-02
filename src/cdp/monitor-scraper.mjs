// src/cdp/monitor-scraper.mjs - 巨量引擎监控单页抓取
export async function scrapeOnePage(client) {
  const r = await client.send('Runtime.evaluate', {
    expression: `
      (() => {
        const campaigns = [];
        const tbodyRows = document.querySelectorAll('tbody tr');

        for (const row of tbodyRows) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 10) continue;

          const data = Array.from(cells).map(c => c.textContent?.trim() || '');

          const nameCell = data[1] || '';
          const lines = nameCell.split(/\\n/).filter(s => s.trim());
          let projectName = lines[0] || nameCell;
          let projectId = '';
          for (const line of lines) {
            const m = line.match(/ID[:：]\\s*(\\d+)/);
            if (m) { projectId = m[1]; projectName = lines[0].replace(/\\s*ID[:：].*$/, '').trim(); break; }
          }
          if (!projectId) {
            for (const line of lines) { if (/^\\d{15,}$/.test(line.trim())) { projectId = line.trim(); break; } }
          }

          campaigns.push({
            name: projectName.substring(0, 80),
            id: projectId,
            status: data[4] || '',
            budget: data[5] || '',
            bid: data[6] || '',
            spend: parseFloat((data[7] || '0').replace(/,/g, '')) || 0,
            leads: parseInt((data[8] || '0').replace(/,/g, '')) || 0,
            conversions: parseInt((data[9] || '0').replace(/,/g, '')) || 0,
            privateMsgOpen: parseInt((data[10] || '0').replace(/,/g, '')) || 0,
            privateMsgRetain: parseInt((data[11] || '0').replace(/,/g, '')) || 0,
            formSubmit: parseInt((data[12] || '0').replace(/,/g, '')) || 0,
            ctr: parseFloat((data[13] || '0%').replace('%', '')) / 100 || 0,
            cpm: parseFloat((data[14] || '0').replace(/,/g, '')) || 0,
            cvr: parseFloat((data[15] || '0%').replace('%', '')) / 100 || 0,
            liveViews: parseInt((data[16] || '0').replace(/,/g, '')) || 0,
            liveOver1Min: parseInt((data[17] || '0').replace(/,/g, '')) || 0,
            liveComments: parseInt((data[18] || '0').replace(/,/g, '')) || 0,
            componentCost: parseFloat((data[19] || '0').replace(/,/g, '')) || 0,
            dislike: parseInt((data[20] || '0').replace(/,/g, '')) || 0,
            report: parseInt((data[21] || '0').replace(/,/g, '')) || 0,
          });
          if (campaigns[campaigns.length-1].liveOver1Min > campaigns[campaigns.length-1].liveViews) {
            const tmp = campaigns[campaigns.length-1].liveViews;
            campaigns[campaigns.length-1].liveViews = campaigns[campaigns.length-1].liveOver1Min;
            campaigns[campaigns.length-1].liveOver1Min = tmp;
          }
        }

        for (const c of campaigns) { c.cpa = c.conversions > 0 ? c.spend / c.conversions : 0; }

        let accountBudget = 0;
        let accountSpend = 0;
        let accountBalance = 0;

        const toolbar = document.querySelector('.oc-promotion-tool-bar');
        if (toolbar) {
          const kvPairs = toolbar.querySelectorAll('.oc-promotion-tool-bar-key-value');
          for (const kv of kvPairs) {
            const spans = kv.querySelectorAll('span');
            const label = spans[0]?.textContent?.trim() || '';
            const valStr = spans[3]?.textContent?.trim() || '';
            const val = parseFloat(valStr.replace(/,/g, '')) || 0;
            if (label.includes('日消耗')) accountSpend = val;
            else if (label.includes('日预算')) accountBudget = val;
            else if (label.includes('账户余额')) accountBalance = val;
          }
        }

        if (accountBudget === 0 && accountSpend === 0) {
          const toolbarText = toolbar?.textContent || document.body.innerText;
          const bMatch = toolbarText.match(/日预算[（(]元[)）]([\\d,]+\\.?\\d*)/);
          const sMatch = toolbarText.match(/日消耗[（(]元[)）]([\\d,]+\\.?\\d*)/);
          if (bMatch) accountBudget = parseFloat(bMatch[1].replace(/,/g, '')) || 0;
          if (sMatch) accountSpend = parseFloat(sMatch[1].replace(/,/g, '')) || 0;
        }

        let pageSummary = null;
        try {
          const summaryRows = document.querySelectorAll('tr.ovui-t-summary');
          if (summaryRows.length > 0) {
            const sumCells = summaryRows[0].querySelectorAll('th, td');
            const sumData = Array.from(sumCells).map(c => c.textContent?.trim() || '');
            const parseNum = (s) => parseFloat((s||'0').replace(/,/g,'')) || 0;
            const parseIntC = (s) => parseInt((s||'0').replace(/,/g,'')) || 0;
            pageSummary = {
              spend:           parseNum(sumData[7]),
              leads:           parseIntC(sumData[8]),
              conversions:     parseIntC(sumData[9]),
              privateMsgOpen:  parseIntC(sumData[10]),
              privateMsgRetain: parseIntC(sumData[11]),
              formSubmit:      parseIntC(sumData[12]),
              cpm:             parseNum(sumData[14]),
              liveViews:       parseIntC(sumData[16]),
              liveOver1Min:    parseIntC(sumData[17]),
            };
          }
        } catch(e) {}

        return JSON.stringify({
          campaigns, count: campaigns.length, time: new Date().toISOString(),
          accountBudget, accountSpend, accountBalance,
          pageSummary,
        });
      })()
    `,
    returnByValue: true
  });
  const result = JSON.parse(r?.result?.result?.value || '{"campaigns":[]}');
  return {
    campaigns: result.campaigns || [],
    accountBudget: result.accountBudget || 0,
    accountSpend: result.accountSpend || 0,
    accountBalance: result.accountBalance || 0,
    pageSummary: result.pageSummary || null,
  };
}
