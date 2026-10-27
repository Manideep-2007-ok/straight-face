// A call that breaks (the connection drops and returns, or the call object dies) must rebuild itself.
//   PLAYWRIGHT_FROM=... CHROMIUM=... node tests/browser/reconnect.mjs ./out
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_FROM || `${process.cwd()}/`);
const { chromium } = require('playwright');
const APP = (process.env.APP || 'http://localhost:5173').replace(/\/$/, '');
let pass = 0; const failures = [];
async function step(name, fn) { try { await fn(); pass++; console.log(`PASS  ${name}`); } catch (e) { failures.push(name); console.log(`FAIL  ${name}\n      ${String(e.message).split('\n')[0].slice(0, 240)}`); } }
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
async function user(email) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(() => { const O = window.RTCPeerConnection; window.__pcs = []; window.RTCPeerConnection = function (...a) { const pc = new O(...a); window.__pcs.push(pc); return pc; }; window.RTCPeerConnection.prototype = O.prototype; });
  const page = await ctx.newPage();
  await page.goto(`${APP}/login`); await page.fill('#email', email); await page.fill('#password', 'demo1234');
  await page.click('button:has-text("Log in")'); await page.waitForURL('**/home');
  return { ctx, page };
}
const frames = (p) => p.evaluate(() => [...document.querySelectorAll('.tile video')].filter((v) => v.videoWidth > 0 && v.readyState >= 2).length);
const both = async (a, b, ms) => { await a.waitForFunction(() => [...document.querySelectorAll('.tile video')].filter((v) => v.videoWidth > 0).length >= 2, null, { timeout: ms }); await b.waitForFunction(() => [...document.querySelectorAll('.tile video')].filter((v) => v.videoWidth > 0).length >= 2, null, { timeout: ms }); };

const A = await user('riya@demo.test'); const B = await user('arjun@demo.test');
const a = A.page, b = B.page;
await a.fill('#rname', 'Reconnect test'); await a.click('button:has-text("Create room")'); await a.waitForURL(/\/room\/[A-Z2-9]{6}$/);
const code = a.url().split('/').pop();
await b.fill('#rcode', code); await b.click('button:has-text("Join room")'); await b.waitForURL(`**/room/${code}`);
await a.click('button:has-text("Join the party")'); await b.click('button:has-text("Join the party")');

await step('the call connects at first', async () => { await both(a, b, 20000); });

// A closed call leaves its last picture on screen, so "video is showing" proves nothing. Wait for a NEW call that is connected.
const liveCall = (p, ms) => p.waitForFunction(() => window.__pcs.some((pc) => pc.connectionState === 'connected' && pc.signalingState !== 'closed'), null, { timeout: ms });

await step('a call object that dies (a phone suspending the tab) is rebuilt by itself', async () => {
  const before = await b.evaluate(() => window.__pcs.length);
  await b.evaluate(() => window.__pcs.forEach((pc) => pc.close()));
  await b.waitForFunction((n) => window.__pcs.length > n, before, { timeout: 40000 }); // a new call was created
  await liveCall(b, 40000);
  await liveCall(a, 40000);
  await both(a, b, 20000);
});

await step('one person\'s connection drops and returns: the call comes back on both sides', async () => {
  const beforeB = await b.evaluate(() => window.__pcs.length);
  await B.ctx.setOffline(true);
  await b.waitForSelector('.banner:has-text("Reconnecting")', { timeout: 80000 });
  await B.ctx.setOffline(false);
  await b.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 30000 });
  await b.waitForFunction((n) => window.__pcs.length > n, beforeB, { timeout: 30000 }); // a fresh call was built after rejoining
  await liveCall(b, 45000);
  await liveCall(a, 45000);
});

await step('the other side dying is also noticed: Riya\'s call is thrown away and rebuilt', async () => {
  const before = await a.evaluate(() => window.__pcs.length);
  await a.evaluate(() => window.__pcs.forEach((pc) => pc.close()));
  await a.waitForFunction((n) => window.__pcs.length > n, before, { timeout: 40000 });
  await liveCall(a, 40000);
  await liveCall(b, 40000);
});

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) console.log('FAILED:\n  - ' + failures.join('\n  - '));
process.exit(failures.length ? 1 : 0);
