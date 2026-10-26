// Two users, two browser contexts, fake camera and microphone. Checks the WebRTC mesh delivers live video both ways.
// Needs the app running locally, `npm run seed` done, Playwright installed somewhere and a Chromium binary.
//   PLAYWRIGHT_FROM=/dir/containing/node_modules/ CHROMIUM=/usr/bin/chromium node tests/browser/webrtc.mjs ./out
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_FROM || `${process.cwd()}/`);
const { chromium } = require('playwright');

const APP = process.env.APP || 'http://localhost:5173';
const OUT = process.argv[2] || '.';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'] /* test only: two headless browsers on one machine cannot resolve mDNS names */,
});

async function user(email) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${email}] pageerror:`, e.message));
  await page.goto(`${APP}/login`);
  await page.fill('#email', email);
  await page.fill('#password', 'demo1234');
  await page.click('button:has-text("Log in")');
  await page.waitForURL('**/home');
  await page.goto(`${APP}/room/PARTY2`);
  await page.click('button:has-text("Join the party")');
  return page;
}

const a = await user('riya@demo.test');
const b = await user('arjun@demo.test');

async function state(page) {
  return page.evaluate(() => {
    const vids = [...document.querySelectorAll('.tile video')];
    return {
      tiles: [...document.querySelectorAll('.tile')].map((t) => t.innerText.replace(/\n/g, ' ')),
      videosWithFrames: vids.filter((v) => v.videoWidth > 0 && v.readyState >= 2).length,
      videoSizes: vids.map((v) => `${v.videoWidth}x${v.videoHeight}`),
    };
  });
}

let ok = false;
const t0 = Date.now();
for (let i = 0; i < 40; i++) {
  const [sa, sb] = await Promise.all([state(a), state(b)]);
  if (sa.videosWithFrames >= 2 && sb.videosWithFrames >= 2) {
    ok = true;
    console.log('connected after', Date.now() - t0, 'ms');
    console.log('riya  :', JSON.stringify(sa));
    console.log('arjun :', JSON.stringify(sb));
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (!ok) {
    console.log('NOT connected. riya:', JSON.stringify(await state(a)), 'arjun:', JSON.stringify(await state(b)));
}

// Mute toggle and camera toggle should work and not break the call.
await a.click('button[aria-label="Mute microphone"]');
await a.click('button[aria-label="Turn camera off"]');
await new Promise((r) => setTimeout(r, 800));
console.log('after riya mutes + camera off, riya tile:', (await state(a)).tiles[0]);

await a.screenshot({ path: `${OUT}/riya.png` });
await b.screenshot({ path: `${OUT}/arjun.png` });
await browser.close();
process.exit(ok ? 0 : 1);
