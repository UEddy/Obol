// Pay a Stripe test invoice on its hosted page with the 4242 test card, in a phone-sized browser, and record
// it sharply (Chrome screencast frames at 3x, with their real timestamps) for the demo's "Get paid" scene.
//   node demo/capture/pay_capture.js <hosted-invoice-url> <out-dir>
// Writes <out-dir>/stripe_pay.mp4 (1170x2532 source, 30 fps) and stripe_pay.json (event times in seconds).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [payUrl, out] = process.argv.slice(2);

(async () => {
  const dir = path.join(out, 'stripe_frames'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const f = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(f, Buffer.from(data, 'base64')); frames.push({ f, t: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  const marks = {}; let t0 = null;
  const mark = (k) => { marks[k] = frames.length ? frames[frames.length - 1].t - t0 : 0; };
  await page.goto(payUrl, { waitUntil: 'load' });
  await page.waitForSelector('iframe[src*="elements-inner-payment"]', { timeout: 60000 });
  await page.waitForTimeout(1500);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1170, maxHeight: 2532 });
  await page.waitForTimeout(400); t0 = frames[0]?.t ?? Date.now() / 1000; mark('start');
  const f = page.frameLocator('iframe[src*="elements-inner-payment"]').first();
  const card = f.getByText('Card', { exact: true }).first(); if (await card.count()) await card.click();
  await page.waitForTimeout(800);
  const num = f.locator('#payment-numberInput'); await num.scrollIntoViewIfNeeded();
  mark('typing');
  await num.pressSequentially('4242424242424242', { delay: 45 });
  await f.locator('#payment-expiryInput').pressSequentially('1230', { delay: 45 });
  await f.locator('#payment-cvcInput').pressSequentially('123', { delay: 45 });
  const zip = f.locator('#payment-postalCodeInput'); if (await zip.count()) await zip.pressSequentially('94107', { delay: 45 });
  const optIn = f.locator('#payment-linkOptInInput');
  if (await optIn.count() && await optIn.isChecked()) {   // don't sign the test card up for Link
    const label = f.locator('label[for="payment-linkOptInInput"]');
    if (await label.count()) await label.first().click({ force: true }).catch(() => {});
    if (await optIn.isChecked()) await optIn.evaluate((el) => el.click());
  }
  await page.waitForTimeout(500);
  const pay = page.getByRole('button', { name: /^Pay/ }); await pay.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
  mark('pay_click'); await pay.click();
  await page.waitForFunction(() => /invoice paid|payment successful|paid on/i.test(document.body.innerText), null, { timeout: 90000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  mark('paid'); await page.waitForTimeout(3500); mark('end');
  await cdp.send('Page.stopScreencast'); await b.close();
  // Frames arrive only when the page changes: hold each until the next one.
  const list = frames.map((fr, i) => `file '${path.resolve(fr.f)}'\nduration ${((frames[i + 1]?.t ?? fr.t + 0.5) - fr.t).toFixed(4)}`).join('\n');
  fs.writeFileSync(path.join(dir, 'list.txt'), list + `\nfile '${path.resolve(frames[frames.length - 1].f)}'\n`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-vf', 'fps=30,scale=1170:-2,format=yuv420p',
    '-c:v', 'libx264', '-crf', '16', path.join(out, 'stripe_pay.mp4')]);
  fs.writeFileSync(path.join(out, 'stripe_pay.json'), JSON.stringify(marks, null, 1));
  console.log(JSON.stringify(marks));
})().catch((e) => { console.error(e.message); process.exit(1); });
