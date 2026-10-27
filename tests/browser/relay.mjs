// FORCE_RELAY=0 runs the same call over a direct path, to compare how much data each uses.
// Forces both browsers to use ONLY the relay (TURN) server, like two devices that cannot reach each other directly,
// and checks that the call still connects and video flows, over a path of type "relay".
//   APP=https://your-site PLAYWRIGHT_FROM=... CHROMIUM=... node tests/browser/relay.mjs
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_FROM || `${process.cwd()}/`);
const { chromium } = require('playwright');
const APP = (process.env.APP || 'http://localhost:5173').replace(/\/$/, '');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
async function user(email) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(`window.__forceRelay = ${process.env.FORCE_RELAY !== '0'};`);
  await ctx.addInitScript(() => {
    const O = window.RTCPeerConnection; window.__pcs = [];
    window.RTCPeerConnection = function (cfg = {}, ...r) { const pc = new O(window.__forceRelay ? { ...cfg, iceTransportPolicy: 'relay' } : cfg, ...r); window.__pcs.push(pc); return pc; };
    window.RTCPeerConnection.prototype = O.prototype;
  });
  const page = await ctx.newPage();
  await page.goto(`${APP}/login`); await page.fill('#email', email); await page.fill('#password', 'demo1234');
  await page.click('button:has-text("Log in")'); await page.waitForURL('**/home');
  return page;
}
const a = await user('riya@demo.test'), b = await user('arjun@demo.test');
await a.fill('#rname', 'Relay test'); await a.click('button:has-text("Create room")'); await a.waitForURL(/\/room\/[A-Z2-9]{6}$/);
const code = a.url().split('/').pop();
await b.fill('#rcode', code); await b.click('button:has-text("Join room")'); await b.waitForURL(`**/room/${code}`);
await a.click('button:has-text("Join the party")'); await b.click('button:has-text("Join the party")');

const path = (p) => p.evaluate(async () => {
  for (const pc of window.__pcs) {
    if (pc.connectionState !== 'connected') continue;
    const rep = await pc.getStats(); let sel;
    rep.forEach((r) => r.type === 'transport' && r.selectedCandidatePairId && (sel = rep.get(r.selectedCandidatePairId)));
    if (sel) return { local: rep.get(sel.localCandidateId)?.candidateType, remote: rep.get(sel.remoteCandidateId)?.candidateType };
  }
  return null;
});
let ok = false, pa, pb;
for (let i = 0; i < 60 && !ok; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  pa = await path(a); pb = await path(b);
  ok = !!pa && !!pb;
}
const frames = async (p) => p.evaluate(() => [...document.querySelectorAll('.tile video')].filter((v) => v.videoWidth > 0 && v.readyState >= 2).length);
console.log('Riya path :', JSON.stringify(pa));
console.log('Arjun path:', JSON.stringify(pb));
console.log('video frames showing  Riya:', await frames(a), ' Arjun:', await frames(b));
// How much data does Riya send? Measure outgoing audio+video bytes over 10 seconds, after the call has settled.
await new Promise((r) => setTimeout(r, 8000));
const sent = (p) => p.evaluate(async () => { let t = 0; for (const pc of window.__pcs) { if (pc.connectionState !== 'connected') continue; (await pc.getStats()).forEach((r) => r.type === 'outbound-rtp' && (t += r.bytesSent || 0)); } return t; });
const limit = (p) => p.evaluate(() => { const o = []; for (const pc of window.__pcs) { if (pc.connectionState !== 'connected') continue; pc.getSenders().forEach((s) => s.track?.kind === 'video' && o.push(s.getParameters().encodings?.[0]?.maxBitrate ?? 'none')); } return o; });
const b0 = await sent(a); await new Promise((r) => setTimeout(r, 10000)); const b1 = await sent(a);
const kbps = Math.round(((b1 - b0) * 8) / 10 / 1000);
console.log(`mode: ${process.env.FORCE_RELAY === '0' ? 'direct' : 'relay only'};  Riya sends about ${kbps} kbit/s (video+audio);  video maxBitrate setting: ${JSON.stringify(await limit(a))}`);
console.log(`=> about ${(kbps * 2 * 3600 / 8 / 1000).toFixed(0)} MB per hour of a 2-person call (both directions)`);
if (process.env.FORCE_RELAY !== '0' && kbps > 300) { console.log('FAIL: the relayed call is using too much data'); await browser.close(); process.exit(1); }
const viaRelay = ok && (pa.local === 'relay' || pa.remote === 'relay') && (pb.local === 'relay' || pb.remote === 'relay');
if (process.env.FORCE_RELAY === '0') { console.log('direct run finished'); await browser.close(); process.exit(0); }
console.log(viaRelay ? 'PASS: connected, through the relay, at a low data rate' : 'FAIL: did not connect through the relay');
await browser.close();
process.exit(viaRelay ? 0 : 1);
