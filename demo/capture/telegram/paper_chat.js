// Telegram stills for the "paper desk" demo: phone-sized (430x932 at 2x), whole conversation on screen, light theme.
//   node paper_chat.js <profile-dir> <bot-username> <steps.json> <out-dir>
// Env: TELEGRAM_BOT_TOKEN (to clear the bot chat between beats), TG_CHAT_ID (the demo account's user id).
//
// steps.json: [{ "name": "draft", "clear": true, "send": "...", "wait": "regex", "phrases": ["$2,150.00"] },
//              { "name": "sent", "click": "Allow Once", "wait": "Pay invoice" }, ...]
// For each step: optionally clear the chat (the bot deletes the messages through the Bot API; Telegram lets bots delete
// messages in their private chats), send a message or press a button, wait for Hermes's reply, then save
// <out-dir>/<name>.png with every bubble whole (text size is reduced until the conversation fits) and the screen
// positions of the listed phrases (in screenshot pixels) to <out-dir>/telegram.json.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [profile, bot, stepsFile, out] = process.argv.slice(2);
const VIEW = { width: 430, height: 932 }; const SCALE = 2;
const CLEAN = `
  .chat-background, .chat-background-item { background: #f3efe7 !important; }
  .chat-background canvas, .chat-background-item-pattern, .chat-background-item-image { display: none !important; }
  .bubbles-date-group .bubble.service.is-date, .bubbles .is-sticky { display: none !important; }`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function bubblesText(page) {
  return page.evaluate(() => [...document.querySelectorAll('.bubbles .bubble')].slice(-6).map((b) => b.innerText).join('\n---\n'));
}
async function waitFor(page, rx, ms = 240000) {
  const re = new RegExp(rx, 'i'); const end = Date.now() + ms;
  while (Date.now() < end) { if (re.test(await bubblesText(page))) return; await page.waitForTimeout(700); }
  throw new Error('timed out waiting for ' + rx + '\n' + await bubblesText(page));
}
async function clearChat(page) {
  const ids = await page.evaluate(() => [...document.querySelectorAll('.bubbles .bubble[data-mid]')]
    .map((b) => Number(b.dataset.mid)).filter((n) => n > 0 && n < 2 ** 31));
  for (let i = 0; i < ids.length; i += 100) {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/deleteMessages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: Number(process.env.TG_CHAT_ID), message_ids: ids.slice(i, i + 100) }) });
    const j = await r.json(); if (!j.ok) console.error('deleteMessages:', j.description);
  }
  await page.waitForTimeout(2500);
}
async function send(page, text) {
  const box = page.locator('.input-message-input[contenteditable="true"]').last();
  await box.focus(); await box.pressSequentially(text, { delay: 8 }); await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
}
// Scroll so the first message is at the top; report whether every bubble is whole inside the chat area.
const layout = (page) => page.evaluate(() => {
  const sc = document.querySelector('.bubbles .scrollable-y') || document.querySelector('.bubbles .scrollable');
  const area = sc.getBoundingClientRect();
  const bs = [...document.querySelectorAll('.bubbles .bubble')].filter((b) => b.offsetParent && !b.classList.contains('is-date'));
  if (!bs.length) return { fits: true };
  sc.scrollTop = 0;
  const first = bs[0].getBoundingClientRect(); const last = bs[bs.length - 1].getBoundingClientRect();
  return { fits: first.top >= area.top - 1 && last.bottom <= area.bottom + 1, top: first.top, bottom: last.bottom,
           areaTop: area.top, areaBottom: area.bottom, n: bs.length };
});
const phraseBoxes = (page, phrases) => page.evaluate((phrases) => {
  const out = {};
  const walker = document.createTreeWalker(document.querySelector('.bubbles') || document.body, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const p of phrases) {
    for (const n of nodes) {
      const i = n.data.indexOf(p); if (i < 0) continue;
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + p.length);
      out[p] = [...r.getClientRects()].map((b) => ({ x: b.x, y: b.y, w: b.width, h: b.height }));
    }
  }
  for (const b of document.querySelectorAll('.reply-markup-button, .reply-markup button')) {
    const r = b.getBoundingClientRect(); out['button:' + b.innerText.trim()] = [{ x: r.x, y: r.y, w: r.width, h: r.height }];
  }
  const bs = [...document.querySelectorAll('.bubbles .bubble')].filter((b) => b.offsetParent);
  out.bubbles = bs.map((b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, out: b.classList.contains('is-out') }; });
  return out;
}, phrases);

(async () => {
  const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8')); fs.mkdirSync(out, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profile, { viewport: VIEW, deviceScaleFactor: SCALE });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`https://web.telegram.org/k/#@${bot}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.input-message-input[contenteditable="true"]', { timeout: 60000 });
  await page.addStyleTag({ content: CLEAN }); await page.waitForTimeout(2500);
  const meta = fs.existsSync(path.join(out, 'telegram.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'telegram.json'), 'utf8')) : {};
  for (const s of steps) {
    if (!s.name) { if (s.pause) await page.waitForTimeout(s.pause); continue; }   // e.g. let the test payment go through
    if (s.clear) await clearChat(page);
    if (s.send) await send(page, s.send);
    if (s.click) await page.locator('.reply-markup-button, .reply-markup button').filter({ hasText: new RegExp(s.click, 'i') }).last().click();
    if (s.wait) await waitFor(page, s.wait);
    await page.waitForTimeout(s.settle ?? 3000);
    if (s.clearAfter) await clearChat(page);   // e.g. drop the approval card so the sent message shows on its own
    let size = 16; let lay = await layout(page);
    while (!lay.fits && size > 12) {           // shrink Telegram's message text until the whole conversation fits
      size -= 1; await page.evaluate((px) => document.documentElement.style.setProperty('--messages-text-size', px + 'px'), size);
      await page.waitForTimeout(600); lay = await layout(page);
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, s.name + '.png') });
    const boxes = await phraseBoxes(page, s.phrases || []);
    for (const k of Object.keys(boxes)) boxes[k] = boxes[k].map((b) => Object.fromEntries(Object.entries(b).map(([kk, v]) => [kk, typeof v === 'number' ? Math.round(v * SCALE) : v])));
    meta[s.name] = { fits: lay.fits, textSize: size, text: await bubblesText(page), boxes, size: [VIEW.width * SCALE, VIEW.height * SCALE] };
    fs.writeFileSync(path.join(out, 'telegram.json'), JSON.stringify(meta, null, 1));
    console.log(s.name, lay.fits ? 'fits' : 'DOES NOT FIT', 'text', size);
    if (size !== 16) await page.evaluate(() => document.documentElement.style.removeProperty('--messages-text-size'));
  }
  await ctx.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
