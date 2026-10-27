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
  await ctx.addInitScript(() => {
    const O = window.RTCPeerConnection; window.__pcs = [];
    window.RTCPeerConnection = function (cfg = {}, ...r) { const pc = new O({ ...cfg, iceTransportPolicy: 'relay' }, ...r); window.__pcs.push(pc); return pc; };
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
const viaRelay = ok && (pa.local === 'relay' || pa.remote === 'relay') && (pb.local === 'relay' || pb.remote === 'relay');
console.log(viaRelay ? 'PASS: connected, and the traffic goes through the relay' : 'FAIL: did not connect through the relay');
await browser.close();
process.exit(viaRelay ? 0 : 1);
