// Screen share and local file share (video and MP3) between real browsers.
//   MEDIA=/dir/with/clip.mp4-and-"my song.mp3" PLAYWRIGHT_FROM=... CHROMIUM=... node tests/browser/share.mjs ./out
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_FROM || `${process.cwd()}/`);
const { chromium } = require('playwright');
const APP = (process.env.APP || 'http://localhost:5173').replace(/\/$/, '');
const MEDIA = process.env.MEDIA || '.';
const OUT = process.argv[2] || '.';
mkdirSync(OUT, { recursive: true });

let pass = 0;
const failures = [];
async function step(name, fn) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { failures.push(name); console.log(`FAIL  ${name}\n      ${String(e.message).split('\n')[0].slice(0, 240)}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined, headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--disable-features=WebRtcHideLocalIpsWithMdns', '--auto-select-desktop-capture-source=Entire screen', '--enable-usermedia-screen-capturing'],
});
const errors = [];
async function user(email) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`));
  await page.goto(`${APP}/login`);
  await page.fill('#email', email);
  await page.fill('#password', 'demo1234');
  await page.click('button:has-text("Log in")');
  await page.waitForURL('**/home');
  return page;
}

// what the viewer actually receives: a playing media element with the right kind of tracks
const received = (page) => page.evaluate(() => {
  const v = document.querySelector('.share-stage video:not(.share-video-local)');
  const s = v?.srcObject;
  return v && s ? { video: s.getVideoTracks().length, audio: s.getAudioTracks().length, t: v.currentTime, w: v.videoWidth, paused: v.paused } : null;
});

const riya = await user('riya@demo.test');
const arjun = await user('arjun@demo.test');
await riya.fill('#rname', 'Share test');
await riya.click('button:has-text("Create room")');
await riya.waitForURL(/\/room\/[A-Z2-9]{6}$/);
const code = riya.url().split('/').pop();
await arjun.fill('#rcode', code);
await arjun.click('button:has-text("Join room")');
await arjun.waitForURL(`**/room/${code}`);
for (const p of [riya, arjun]) await p.click('button:has-text("Join the party")');
await riya.waitForFunction(() => document.querySelectorAll('.tile').length === 2);

await step('the share buttons are visible and enabled', async () => {
  ok(await riya.locator('button:has-text("Share screen or tab")').isEnabled());
  ok(await riya.locator('button:has-text("Play a local video or song")').isEnabled());
});

// ---------------- local video file
await step('video file: Riya picks an MP4 and Arjun sees it playing with picture and sound', async () => {
  await riya.setInputFiles('input[type=file]', path.join(MEDIA, 'clip.mp4'));
  await arjun.waitForSelector('.share-bar:has-text("Riya is sharing clip.mp4")', { timeout: 15000 });
  await arjun.waitForFunction(() => { const v = document.querySelector('.share-stage video'); return v?.srcObject && v.videoWidth > 0 && v.currentTime > 0.5; }, null, { timeout: 20000 });
  const r = await received(arjun);
  ok(r.video >= 1 && r.audio >= 1, `tracks: ${JSON.stringify(r)}`);
});
await step('video file: the picture keeps moving (not a frozen frame)', async () => {
  const a = (await received(arjun)).t;
  await wait(2000);
  const b = (await received(arjun)).t;
  ok(b > a + 1, `time did not advance: ${a} -> ${b}`);
});
await step('video file: the sharer sees the bar with "Stop sharing", the others do not', async () => {
  ok(await riya.locator('.share-bar button:has-text("Stop sharing")').count() === 1);
  ok(await arjun.locator('.share-bar button:has-text("Stop sharing")').count() === 0);
});
await step('while sharing: the share buttons are disabled for everyone and YouTube is refused', async () => {
  ok(await arjun.locator('button:has-text("Share screen or tab")').isDisabled());
  await arjun.fill('#yt', 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  await arjun.click('button:has-text("Play this video")');
  await arjun.waitForSelector('[role=alert]:has-text("is sharing")');
});
await step('late joiner: a third person arriving mid-share receives the video too', async () => {
  const meera = await user('meera@demo.test');
  await meera.fill('#rcode', code);
  await meera.click('button:has-text("Join room")');
  await meera.waitForURL(`**/room/${code}`);
  await meera.click('button:has-text("Join the party")');
  await meera.waitForFunction(() => { const v = document.querySelector('.share-stage video'); return v?.srcObject && v.videoWidth > 0; }, null, { timeout: 20000 });
  await meera.screenshot({ path: path.join(OUT, 'share-late-joiner.png') });
  await meera.context().close();
});
await step('Stop sharing ends it for everyone and YouTube works again', async () => {
  await riya.click('.share-bar button:has-text("Stop sharing")');
  await arjun.waitForFunction(() => !document.querySelector('.share-stage'), null, { timeout: 10000 });
  await riya.waitForFunction(() => !document.querySelector('.share-stage'), null, { timeout: 10000 });
  ok(await arjun.locator('button:has-text("Share screen or tab")').isEnabled());
  await arjun.fill('#yt', 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  await arjun.click('button:has-text("Play this video")');
  await riya.waitForSelector('.action-line:has-text("Arjun played")', { timeout: 10000 });
});

// ---------------- mp3
await step('MP3: Arjun picks "my song.mp3" and Riya hears it (audio only, with a now-playing card)', async () => {
  await arjun.setInputFiles('input[type=file]', path.join(MEDIA, 'my song.mp3'));
  await riya.waitForSelector('.share-bar:has-text("Arjun is sharing my song.mp3")', { timeout: 15000 });
  await riya.waitForSelector('.audio-card:has-text("my song.mp3")', { timeout: 15000 });
  await riya.waitForFunction(() => { const v = document.querySelector('.share-stage video'); return v?.srcObject?.getAudioTracks().length > 0 && v.currentTime > 0.5; }, null, { timeout: 20000 });
  const r = await received(riya);
  ok(r.audio >= 1 && r.video === 0, `expected audio only, got ${JSON.stringify(r)}`);
  await riya.screenshot({ path: path.join(OUT, 'share-mp3-viewer.png') });
  await arjun.screenshot({ path: path.join(OUT, 'share-mp3-sharer.png') });
});
await step('MP3: the sound keeps playing', async () => {
  const a = (await received(riya)).t;
  await wait(2000);
  ok((await received(riya)).t > a + 1);
});
await step('MP3: the sharer can stop it from their screen', async () => {
  await arjun.click('.share-bar button:has-text("Stop sharing")');
  await riya.waitForFunction(() => !document.querySelector('.share-stage'), null, { timeout: 10000 });
});

// ---------------- a file the browser cannot play
await step('a file that is not media shows a clear error and does not break the room', async () => {
  await riya.setInputFiles('input[type=file]', { name: 'notes.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('this is not audio') });
  await riya.waitForSelector('[role=alert]:has-text("could not be played")', { timeout: 10000 });
  await riya.waitForFunction(() => !document.querySelector('.share-stage'), null, { timeout: 5000 });
  ok(await riya.locator('button:has-text("Share screen or tab")').isEnabled());
});

// ---------------- screen / tab share
await step('screen share: Arjun sees Riya\'s screen', async () => {
  await riya.click('button:has-text("Share screen or tab")');
  await arjun.waitForSelector('.share-bar:has-text("Riya is sharing a tab or screen")', { timeout: 20000 });
  await arjun.waitForFunction(() => { const v = document.querySelector('.share-stage video'); return v?.srcObject && v.videoWidth > 0 && v.currentTime > 0.3; }, null, { timeout: 20000 });
  await arjun.screenshot({ path: path.join(OUT, 'share-screen-viewer.png') });
});
await step('screen share: the sharer can stop it', async () => {
  await riya.click('.share-bar button:has-text("Stop sharing")');
  await arjun.waitForFunction(() => !document.querySelector('.share-stage'), null, { timeout: 10000 });
});
await step('screen share: cancelling the browser picker does nothing bad', async () => {
  const ctx2 = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const p = await ctx2.newPage();
  await p.addInitScript(() => { navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException('cancelled', 'NotAllowedError')); });
  await p.goto(`${APP}/login`);
  await p.fill('#email', 'meera@demo.test');
  await p.fill('#password', 'demo1234');
  await p.click('button:has-text("Log in")');
  await p.waitForURL('**/home');
  await p.goto(`${APP}/room/${code}`);
  await p.click('button:has-text("Join the party")');
  await p.click('button:has-text("Share screen or tab")');
  await wait(800);
  ok((await p.locator('.share-stage').count()) === 0 && (await p.locator('[role=alert]:has-text("Could not")').count()) === 0, 'cancel should be silent');
  await ctx2.close();
});

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) console.log('FAILED:\n  - ' + failures.join('\n  - '));
if (errors.length) console.log('page errors:\n  ' + [...new Set(errors)].join('\n  '));
process.exit(failures.length ? 1 : 0);
