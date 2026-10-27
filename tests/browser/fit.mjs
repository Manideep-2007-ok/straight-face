// A shared video file must fit the stage whatever its shape (wide, portrait, ultrawide), at several screen sizes, with its
// control bar visible when paused. Needs three clips named wide1080.mp4, portrait.mp4, ultrawide.mp4 in MEDIA, e.g. made with
//   ffmpeg -f lavfi -i testsrc=duration=20:size=1080x1920:rate=25 -f lavfi -i sine=duration=20 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest portrait.mp4
//   MEDIA=/dir PLAYWRIGHT_FROM=... CHROMIUM=... node tests/browser/fit.mjs ./out
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_FROM || `${process.cwd()}/`)('playwright');
const APP = process.env.APP || 'http://localhost:5173';
const MEDIA = process.env.MEDIA || '.';
const OUT = process.argv[2] || '.';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, headless: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
let bad = 0;
for (const [w, h] of [[1920, 1080], [1366, 768], [1100, 800], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  await page.goto(`${APP}/login`); await page.fill('#email', 'meera@demo.test'); await page.fill('#password', 'demo1234');
  await page.click('button:has-text("Log in")'); await page.waitForURL('**/home');
  await page.fill('#rname', 'fit'); await page.click('button:has-text("Create room")'); await page.waitForURL(/\/room\//);
  await page.click('button:has-text("Join the party")'); await page.waitForSelector('.stage-wrap');
  const stage = await page.evaluate(() => { const r = document.querySelector('.stage-wrap').getBoundingClientRect(); const col = document.querySelector('.stage').getBoundingClientRect(); const t = document.querySelector('.tiles')?.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), colW: Math.round(col.width), tilesTop: t && Math.round(t.top), vh: innerHeight }; });
  console.log(`\nviewport ${w}x${h}: stage ${stage.w}x${stage.h} (column is ${stage.colW} wide), people tiles start at y=${stage.tilesTop} of ${stage.vh}`);
  for (const clip of ['wide1080.mp4', 'portrait.mp4', 'ultrawide.mp4']) {
    await page.setInputFiles('input[type=file]', `${MEDIA}/${clip}`);
    await page.waitForSelector('.share-stage video.share-video', { timeout: 15000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelector('.share-stage video').pause());
    await page.hover('.share-stage');
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => { const st = document.querySelector('.share-stage').getBoundingClientRect(); const v = document.querySelector('.share-stage video').getBoundingClientRect(); return { stage: [Math.round(st.width), Math.round(st.height)], video: [Math.round(v.width), Math.round(v.height)], bottomOverflow: Math.round(v.bottom - st.bottom), topOverflow: Math.round(st.top - v.top) }; });
    const fits = r.bottomOverflow <= 1 && r.topOverflow <= 1 && r.video[1] <= r.stage[1] + 1;
    if (!fits) bad++;
    console.log(`  ${clip.padEnd(14)} video box ${r.video.join('x')} in stage ${r.stage.join('x')}  bottom overflow ${r.bottomOverflow}px  -> ${fits ? 'fits, controls visible' : 'OVERFLOWS: controls cut off'}`);
    if (w === 1366 && clip === 'portrait.mp4') await page.screenshot({ path: `${OUT}/fit-${w}-portrait.png` });
    await page.click('.share-bar button:has-text("Stop sharing")');
    await page.waitForFunction(() => !document.querySelector('.share-stage'), null, { timeout: 8000 });
  }
  await ctx.close();
}
await browser.close();
console.log(bad ? `\n${bad} case(s) overflow` : '\nall cases fit');
process.exit(bad ? 1 : 0);
