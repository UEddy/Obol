// Log Telegram Web into a throwaway browser profile by QR code, for recording the Telegram scene.
//   node demo/capture/telegram/login.js <profile-dir> <qr-png>
// Writes the current QR code to <qr-png> (refreshed every few seconds, since Telegram rotates it) until the
// account is logged in, then writes <qr-png>.done. The profile holds the Telegram session: keep it OUTSIDE
// the repo and delete it when recording is done (never commit or share it).
const { chromium } = require('playwright');
const fs = require('fs');
const [profile, qr] = process.argv.slice(2);
(async () => {
  const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 900, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://web.telegram.org/k/', { waitUntil: 'domcontentloaded' });
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const qrShown = await page.locator('[class*="qrContainer"]').count();
    if (!qrShown && await page.locator('.chatlist-chat, a.chatlist-chat, .input-search input').count()) {
      fs.writeFileSync(qr + '.done', 'ok'); console.log('logged in'); break;
    }
    const code = page.locator('[class*="qrContainer"], .qr-container').first();
    if (await code.count() && await code.locator('canvas').count()) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: qr + '.tmp.png' });
      fs.renameSync(qr + '.tmp.png', qr);
    } else if (await page.getByText(/password/i).count()) {
      await page.screenshot({ path: qr });   // two-step verification: show the screen
    }
    await page.waitForTimeout(3000);
  }
  await ctx.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
