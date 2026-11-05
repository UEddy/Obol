// Record the Obol dashboard's Invoices view, then its Security view, and save catalog screenshots. Usage:
//   node demo/capture/record_views.js <dashboard-url> <out-dir> <screenshot-dir>
// Writes <out-dir>/views.webm (1920x1080), <out-dir>/views.json (timings and element boxes), and
// <screenshot-dir>/dashboard-invoices.png and dashboard-security.png (1600x1000 at 2x).
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [url, out, shots] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(shots, { recursive: true });
  const b = await chromium.launch();
  const ready = (p) => p.waitForFunction(() => /\$3,600\.00/.test(document.body.innerText) && !/SYNCING/.test(document.body.innerText),
    null, { timeout: 90000 });
  // Screenshots first (also warms the Stripe sync).
  const s = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await s.goto(url); const nt = s.getByText('No thanks'); await s.waitForTimeout(1500); if (await nt.count()) await nt.click();
  await ready(s); await s.waitForTimeout(1200);
  await s.screenshot({ path: `${shots}/dashboard-invoices.png` });
  await s.getByRole('tab', { name: /^security$/i }).first().click(); await s.waitForTimeout(1500);
  await s.screenshot({ path: `${shots}/dashboard-security.png` });
  await s.close();

  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: out, size: { width: 1920, height: 1080 } } });
  const p = await ctx.newPage(); const t0 = Date.now(); const t = () => (Date.now() - t0) / 1000;
  await p.goto(url); await ready(p);
  const box = async (sel) => { const el = p.locator(sel).first(); return (await el.count()) ? await el.boundingBox() : null; };
  const info = { invoices_ready: t(), overdue: await box('.obol-kpi:nth-child(2)'), kpis: await box('.obol-kpis'), table: await box('.obol-table') };
  await p.waitForTimeout(6000);
  await p.getByRole('tab', { name: /^security$/i }).first().click(); info.security_click = t();
  await p.waitForTimeout(1500);
  info.security_table = await box('.obol-table');
  await p.mouse.wheel(0, 300); await p.waitForTimeout(5000);
  info.end = t();
  const video = p.video(); await ctx.close();
  fs.renameSync(await video.path(), `${out}/views.webm`);
  fs.writeFileSync(`${out}/views.json`, JSON.stringify(info, null, 1));
  await b.close(); console.log(JSON.stringify(info));
})();
