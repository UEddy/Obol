// Screenshot individual rows of the real Security view (2x) for the demo, with the detail cell's box.
//   node demo/capture/security_rows.js <dashboard-url> <out-dir>
// Writes row_<key>.png for each row matched below and rows.json ({key: {w, h, detail: [x, y, w, h], threat: [...]}}).
const { chromium } = require('playwright');
const fs = require('fs');
const [url, out] = process.argv.slice(2);
const ROWS = { hidden: /zero-width/, encoded: /base64/, translated: /override Hermes/, unattended: /unattended run/,
  fraud: /Fraud risk for/, dispute: /disputed the/ };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await p.goto(url + (url.includes('?') ? '&' : '?') + 'view=security'); await p.waitForTimeout(1500);
  const nt = p.getByText('No thanks'); if (await nt.count()) await nt.click();
  await p.waitForFunction(() => /THREATS FLAGGED/i.test(document.body.innerText), null, { timeout: 90000 });
  await p.waitForTimeout(1200);
  const info = {};
  for (const [key, rx] of Object.entries(ROWS)) {
    const row = p.locator('tbody tr').filter({ hasText: rx }).first();
    if (!(await row.count())) { console.log('missing', key); continue; }
    await row.scrollIntoViewIfNeeded();
    await row.screenshot({ path: `${out}/row_${key}.png` });
    const rb = await row.boundingBox();
    const cell = async (i) => { const c = await row.locator('td').nth(i).boundingBox(); return [(c.x - rb.x) * 2, (c.y - rb.y) * 2, c.width * 2, c.height * 2]; };
    info[key] = { w: rb.width * 2, h: rb.height * 2, threat: await cell(1), detail: await cell(4) };
  }
  fs.writeFileSync(`${out}/rows.json`, JSON.stringify(info, null, 1));
  console.log(JSON.stringify(info));
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
