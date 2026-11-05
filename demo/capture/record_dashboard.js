// Record the real Obol dashboard (Hermes web UI) for the demo. Usage:
//   node demo/capture/record_dashboard.js <dashboard-url> <out-dir> [seconds]
// Writes <out-dir>/dashboard.webm (1920x1080) and <out-dir>/dashboard.json (positions of key elements).
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [url, out, secs = '10'] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  // Warm-up pass so the first sync with Stripe finishes before recording starts.
  const warm = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await warm.goto(url); await warm.waitForTimeout(2000);
  const nt = warm.getByText('No thanks'); if (await nt.count()) await nt.click();
  await warm.waitForFunction(() => /\$3,600\.00/.test(document.body.innerText), null, { timeout: 90000 });
  await warm.waitForTimeout(3000); await warm.close();
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: out, size: { width: 1920, height: 1080 } } });
  const p = await ctx.newPage();
  await p.goto(url);
  await p.waitForFunction(() => /\$3,600\.00/.test(document.body.innerText), null, { timeout: 60000 });
  const t0 = Date.now();
  const box = async (sel) => { const el = p.locator(sel).first(); return (await el.count()) ? await el.boundingBox() : null; };
  const info = { overdue: await box('.obol-kpi:nth-child(2)'), kpis: await box('.obol-kpis'), table: await box('.obol-table'), badge: await box('.obol-badge') };
  await p.waitForTimeout(Number(secs) * 1000);
  const video = p.video(); await ctx.close();
  const raw = await video.path();
  fs.renameSync(raw, `${out}/dashboard.webm`);
  info.ready_ms = Date.now() - t0;
  fs.writeFileSync(`${out}/dashboard.json`, JSON.stringify(info, null, 1));
  await b.close();
  console.log(JSON.stringify(info));
})();
