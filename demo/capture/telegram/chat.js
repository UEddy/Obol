// Drive a Telegram Web chat with the demo bot from a logged-in throwaway profile (see login.js).
//   node chat.js <profile-dir> <bot-username> send "<text>" [<wait-regex>]       one message, no recording
//   node chat.js <profile-dir> <bot-username> record <steps.json> <out-dir>       phone-sized, recorded
// steps.json: [{"send": "...", "wait": "regex"} | {"click": "button label regex", "wait": "regex"} | {"pause": ms}]
// Recording uses Chrome screencast frames at 3x (sharp text) with their real timestamps -> <out-dir>/telegram.mp4
// and <out-dir>/telegram.json (when each step happened, in seconds).
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const [profile, bot, mode, a1, a2, a3] = process.argv.slice(2);

async function open(viewport, scale) {
  const ctx = await chromium.launchPersistentContext(profile, { viewport, deviceScaleFactor: scale });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`https://web.telegram.org/k/#@${bot}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.input-message-input[contenteditable="true"]', { timeout: 60000 });
  await page.waitForTimeout(2500);
  return { ctx, page };
}
const lastText = (page) => page.evaluate(() => {
  const b = [...document.querySelectorAll('.bubbles .bubble')]; return b.slice(-6).map((x) => x.innerText).join('\n---\n');
});
async function send(page, text) {
  const start = page.locator('button, .btn-primary').filter({ hasText: /^\s*start\s*$/i });
  if (text === '/start' && await start.count() && await start.first().isVisible()) { await start.first().click(); return; }
  const box = page.locator('.input-message-input[contenteditable="true"]').last();
  await box.focus(); await box.pressSequentially(text, { delay: 18 }); await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
}
async function waitFor(page, rx, ms = 240000) {
  const re = new RegExp(rx, 'i'); const end = Date.now() + ms;
  while (Date.now() < end) { if (re.test(await lastText(page))) return true; await page.waitForTimeout(700); }
  throw new Error('timed out waiting for ' + rx + '\n' + await lastText(page));
}

(async () => {
  if (mode === 'send') {
    const { ctx, page } = await open({ width: 430, height: 900 }, 1);
    await send(page, a1); if (a2) await waitFor(page, a2, 120000);
    await page.waitForTimeout(1500); console.log(await lastText(page)); await ctx.close(); return;
  }
  const steps = JSON.parse(fs.readFileSync(a1, 'utf8')); const out = a2;
  const dir = path.join(out, 'telegram_frames'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const { ctx, page } = await open({ width: 390, height: 844 }, 3);
  const cdp = await ctx.newCDPSession(page); const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const f = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(f, Buffer.from(data, 'base64')); frames.push({ f, t: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1170, maxHeight: 2532 });
  await page.waitForTimeout(800);
  const t0 = frames[0]?.t ?? Date.now() / 1000; const marks = [];
  const now = () => (frames.length ? frames[frames.length - 1].t : t0) - t0;
  for (const s of steps) {
    const m = { ...s, start: now() };
    if (s.send) await send(page, s.send);
    if (s.click) await page.locator('.reply-markup-button, .reply-markup button').filter({ hasText: new RegExp(s.click, 'i') }).last().click();
    if (s.wait) await waitFor(page, s.wait);
    if (s.pause) await page.waitForTimeout(s.pause);
    m.end = now(); marks.push(m); console.log(JSON.stringify(m));
  }
  await page.waitForTimeout(2500);
  await cdp.send('Page.stopScreencast'); await ctx.close();
  const list = frames.map((fr, i) => `file '${path.resolve(fr.f)}'\nduration ${((frames[i + 1]?.t ?? fr.t + 0.5) - fr.t).toFixed(4)}`).join('\n');
  fs.writeFileSync(path.join(dir, 'list.txt'), list + `\nfile '${path.resolve(frames[frames.length - 1].f)}'\n`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', 'fps=30,scale=1170:-2,format=yuv420p', '-c:v', 'libx264', '-crf', '16', path.join(out, 'telegram.mp4')]);
  fs.writeFileSync(path.join(out, 'telegram.json'), JSON.stringify(marks, null, 1));
})().catch((e) => { console.error(e.message); process.exit(1); });
