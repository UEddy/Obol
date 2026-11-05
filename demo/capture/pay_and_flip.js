// Beat 5: pay a real Stripe test invoice on Stripe's hosted page with the 4242 test card, then show
// the Obol dashboard picking up the payment (row stamps PAID). Records two videos.
//   node demo/capture/pay_and_flip.js <hosted-invoice-url> <dashboard-url> <out-dir>
const { chromium } = require('playwright');
const fs = require('fs');
const [payUrl, dashUrl, out] = process.argv.slice(2);
const V = { width: 1920, height: 1080 };

async function record(browser, name) {
  const ctx = await browser.newContext({ viewport: V, recordVideo: { dir: out, size: V } });
  return { ctx, page: await ctx.newPage(), name };
}
async function save(r) {
  const v = r.page.video(); await r.ctx.close();
  fs.renameSync(await v.path(), `${out}/${r.name}.webm`);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const marks = {};
  const t0 = Date.now(); const mark = (k) => { marks[k] = (Date.now() - t0) / 1000; };

  // Dashboard first, so it is open (and recording) when the payment lands.
  const dash = await record(b, 'dashboard_flip');
  await dash.page.goto(dashUrl);
  await dash.page.waitForTimeout(1500);
  const nt = dash.page.getByText('No thanks'); if (await nt.count()) await nt.click();
  await dash.page.waitForFunction(() => /Pinemoor/i.test(document.body.innerText), null, { timeout: 90000 });
  mark('dash_ready');

  const pay = await record(b, 'stripe_pay');
  await pay.page.goto(payUrl, { waitUntil: 'load' });
  await pay.page.waitForSelector('iframe[src*="elements-inner-payment"]', { timeout: 60000 });
  await pay.page.waitForTimeout(2500);
  mark('pay_page_ready');
  const f = pay.page.frameLocator('iframe[src*="elements-inner-payment"]').first();
  await f.getByText('Card', { exact: true }).first().click();
  await pay.page.waitForTimeout(900);
  await f.locator('#payment-numberInput').pressSequentially('4242424242424242', { delay: 55 });
  await f.locator('#payment-expiryInput').pressSequentially('1230', { delay: 55 });
  await f.locator('#payment-cvcInput').pressSequentially('123', { delay: 55 });
  const zip = f.locator('#payment-postalCodeInput'); if (await zip.count()) await zip.pressSequentially('94107', { delay: 55 });
  const optIn = f.locator('#payment-linkOptInInput');
  if (await optIn.count() && await optIn.isChecked()) await optIn.uncheck({ force: true });
  await pay.page.waitForTimeout(700);
  mark('pay_click');
  await pay.page.getByRole('button', { name: /^Pay/ }).click();
  await pay.page.waitForFunction(() => /invoice paid|payment successful|paid on/i.test(document.body.innerText), null, { timeout: 90000 });
  mark('paid_confirmed');
  await pay.page.waitForTimeout(4000);
  await save(pay);

  // Back on the dashboard: sync, and wait for the row's stamp to flip to PAID.
  await dash.page.waitForTimeout(1500);
  mark('sync_click');
  await dash.page.getByRole('button', { name: /sync with stripe/i }).click();
  await dash.page.waitForFunction(() => {
    const row = [...document.querySelectorAll('tr')].find((r) => /Pinemoor/i.test(r.innerText));
    return row && /paid/i.test(row.querySelector('.obol-stamp')?.innerText || '');
  }, null, { timeout: 90000 });
  mark('flipped');
  await dash.page.waitForTimeout(5000);
  await save(dash);
  fs.writeFileSync(`${out}/pay_and_flip.json`, JSON.stringify(marks, null, 1));
  console.log(JSON.stringify(marks));
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
