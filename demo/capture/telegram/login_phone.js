// Log Telegram Web into a throwaway profile by phone number (when a QR scan isn't possible).
//   TG_PHONE="+<country><number>" node login_phone.js <profile-dir> <work-dir>
// Enters the number, then waits for <work-dir>/code (the login code Telegram sends to your Telegram app) and, if
// the account has two-step verification, <work-dir>/password. Writes <work-dir>/state.png at each step and
// <work-dir>/done when logged in. Keep the profile OUTSIDE the repo; delete it and end the session in
// Telegram › Settings › Devices when recording is done. Neither the number nor the code is written anywhere else.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [profile, work] = process.argv.slice(2);
const phone = (process.env.TG_PHONE || '').replace(/[^\d+]/g, '');
const shot = (page, name) => page.screenshot({ path: path.join(work, name) });
const waitFile = async (f, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fs.existsSync(f)) { const v = fs.readFileSync(f, 'utf8').trim(); fs.unlinkSync(f); return v; } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error('timed out waiting for ' + f);
};
(async () => {
  if (!phone) throw new Error('set TG_PHONE');
  fs.mkdirSync(work, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 900, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://web.telegram.org/k/', { waitUntil: 'domcontentloaded' });
  await page.getByText(/log in by phone number/i).click({ timeout: 60000 });
  const input = page.locator('.input-field-phone .input-field-input').first();   // not the country picker before it
  await input.waitFor({ timeout: 30000 });
  await input.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace');
  await input.pressSequentially(phone, { delay: 40 });
  await page.waitForTimeout(800);
  await page.locator('button.btn-primary').filter({ hasText: /next/i }).first().click();
  await page.waitForTimeout(3000); await shot(page, 'state.png');
  console.log('number entered; waiting for code');
  const code = await waitFile(path.join(work, 'code'), 10 * 60 * 1000);
  await page.keyboard.type(code, { delay: 80 });
  await page.waitForTimeout(5000); await shot(page, 'state.png');
  if (await page.locator('input[type="password"]').count()) {
    console.log('two-step verification: waiting for password');
    const pw = await waitFile(path.join(work, 'password'), 10 * 60 * 1000);
    await page.locator('input[type="password"]').first().fill(pw);
    await page.keyboard.press('Enter'); await page.waitForTimeout(5000); await shot(page, 'state.png');
  }
  await page.waitForSelector('.chatlist-chat, .input-search input', { timeout: 60000 });
  fs.writeFileSync(path.join(work, 'done'), 'ok'); console.log('logged in');
  await ctx.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
