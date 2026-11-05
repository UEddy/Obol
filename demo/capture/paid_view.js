// Record a paid invoice's Stripe hosted page (the confirmation the payer sees), phone-sized and sharp.
//   node demo/capture/paid_view.js <hosted-invoice-url> <out-dir>   -> <out-dir>/stripe_paid.mp4
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const [url, out] = process.argv.slice(2);
(async () => {
  const dir = path.join(out, 'paid_frames'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => /paid/i.test(document.body.innerText), null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 2; i++) await page.screenshot({ path: path.join(dir, `f${i}.png`) });
  await b.close();
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-t', '4', '-i', path.join(dir, 'f1.png'), '-vf', 'fps=30,format=yuv420p',
    '-c:v', 'libx264', '-crf', '16', path.join(out, 'stripe_paid.mp4')]);
  console.log('ok');
})().catch((e) => { console.error(e.message); process.exit(1); });
