// Sharp screenshots of the real Obol dashboard for the demo, plus where things are on them.
//   node demo/capture/dashboard_shots.js <dashboard-url> <out-dir>
// Writes invoices.png and security.png (1600x1000 viewport at 2x) and boxes.json: element boxes in screenshot
// pixels (KPI cards, and the rows / risk cells of the invoices to point at).
const { chromium } = require('playwright');
const fs = require('fs');
const [url, out] = process.argv.slice(2);
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await p.goto(url); await p.waitForTimeout(1500);
  const nt = p.getByText('No thanks'); if (await nt.count()) await nt.click();
  await p.getByRole('button', { name: /sync now/i }).click().catch(() => {});
  await p.waitForFunction(() => /OUTSTANDING/i.test(document.body.innerText) && !/Syncing/i.test(document.body.innerText), null, { timeout: 90000 });
  await p.waitForTimeout(1500);
  const box = async (loc) => { const bb = await loc.first().boundingBox(); return bb && [bb.x * 2, bb.y * 2, bb.width * 2, bb.height * 2]; };
  const boxes = { kpis: await box(p.locator('.obol-kpis')) };
  for (const [i, k] of ['outstanding', 'overdue', 'paid'].entries()) boxes[k] = await box(p.locator('.obol-kpi').nth(i));
  await p.screenshot({ path: `${out}/invoices.png`, fullPage: true });
  for (const name of ['Harbor & Pine', 'Olive Street Bakery']) {
    const row = p.locator('tr', { hasText: name }).first();
    boxes[name] = { row: await box(row), risk: await box(row.locator('.obol-risk')) };
  }
  await p.getByRole('tab', { name: /^security$/i }).first().click(); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/security.png`, fullPage: true });
  const sec = {};
  for (const name of ['Disputed', 'Dispute', 'Fraud risk', 'Unattended write refused', 'Live key refused']) {
    const row = p.locator('tr', { hasText: name });
    if (await row.count()) sec[name] = await box(row);
  }
  boxes.security = sec;
  fs.writeFileSync(`${out}/boxes.json`, JSON.stringify(boxes, null, 1));
  console.log(JSON.stringify(boxes));
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
