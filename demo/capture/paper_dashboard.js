// The Obol dashboard tab for the paper-desk demo: one whole screen, ending on a whole table row.
//   node demo/capture/paper_dashboard.js <dashboard-url> <out.png>
// Syncs first (the same totals as the terminal ledger shot), then sizes the 1600-wide viewport so its bottom
// edge falls exactly on the bottom of a table row, and saves it at 2x.
const { chromium } = require('playwright');
const [url, out] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await p.goto(url); await p.waitForTimeout(1500);
  const nt = p.getByText('No thanks'); if (await nt.count()) await nt.click();
  await p.getByRole('button', { name: /sync now/i }).click().catch(() => {});
  await p.waitForFunction(() => /OUTSTANDING/i.test(document.body.innerText) && !/Syncing/i.test(document.body.innerText), null, { timeout: 90000 });
  await p.waitForTimeout(2000);
  const bottoms = await p.evaluate(() => [...document.querySelectorAll('tbody tr')].map((r) => r.getBoundingClientRect().bottom));
  const fit = bottoms.filter((y) => y <= 1000).pop() ?? 1000;
  await p.setViewportSize({ width: 1600, height: Math.floor(fit) });
  await p.waitForTimeout(800);
  await p.screenshot({ path: out });
  console.log(await p.evaluate(() => document.querySelector('.obol-kpis')?.innerText.replace(/\s+/g, ' ')));
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
