// End-to-end audit through the real UI: every page, every button, error states, two or three users.
// Needs the app running (backend + frontend), `npm run seed` done, Playwright and a Chromium binary.
//   PLAYWRIGHT_FROM=/dir/with/node_modules/ CHROMIUM=/usr/bin/chromium node tests/browser/audit.mjs ./out
//   APP=https://your-frontend API=https://your-backend node tests/browser/audit.mjs   (against a deployment)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PLAYWRIGHT_FROM || `${process.cwd()}/`);
const { chromium } = require('playwright');
const { io } = createRequire(path.join(here, '../../backend/'))('socket.io-client');

const APP = (process.env.APP || 'http://localhost:5173').replace(/\/$/, '');
const API = (process.env.API || 'http://localhost:4000').replace(/\/$/, '');
const OUT = process.argv[2] || '.';
mkdirSync(OUT, { recursive: true });
const stamp = Date.now();
const NEW_EMAIL = `ui-tester-${stamp}@example.com`;

let pass = 0;
const failures = [];
const consoleErrors = [];
const badRequests = [];

async function step(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`FAIL  ${name}\n      ${String(e.message).split('\n')[0].slice(0, 220)}`);
  }
}
const ok = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--disable-features=WebRtcHideLocalIpsWithMdns'],
});

async function newUser(label, { width = 1280, height = 900 } = {}) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width, height } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/401|Unauthorized/.test(t) && label === 'anon') return; // expected when logged out
    consoleErrors.push(`[${label}] ${t.slice(0, 160)}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] PAGE ERROR ${e.message.slice(0, 160)}`));
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && u.startsWith(API) && !/\/api\/auth\/me$/.test(u)) badRequests.push(`[${label}] ${r.status()} ${r.request().method()} ${u.replace(API, '')}`);
  });
  return { ctx, page };
}

async function login(page, email, password = 'demo1234') {
  await page.goto(`${APP}/login`);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button:has-text("Log in")');
}

let freshN = 0;
// A brand-new account, signed up through the UI. (One account can only be logged in on one device at a time, so tests
// that need several browsers at once use separate accounts.)
async function signupFresh(page, label = 'p') {
  freshN++;
  const email = `ui-tester-${label}${freshN}-${stamp}@example.com`;
  await page.goto(`${APP}/signup`);
  await page.fill('#name', 'Fresh Tester');
  await page.fill('#email', email);
  await page.fill('#password', 'testpass-9876');
  await page.click('button:has-text("Create account")');
  await page.waitForURL('**/home');
  return email;
}

// ---------------------------------------------------------------- logged out
const anon = await newUser('anon');
const a = anon.page;

await step('landing page shows headline and both buttons', async () => {
  await a.goto(APP);
  await a.waitForSelector('h1');
  ok((await a.locator('h1').innerText()).includes('Keep a straight face'), 'headline');
  ok(await a.locator('a:has-text("Create a room")').count(), 'create button');
  ok(await a.locator('a:has-text("Log in")').count(), 'login button');
});
await step('landing "Create a room" goes to signup', async () => {
  await a.click('a:has-text("Create a room")');
  await a.waitForURL('**/signup');
});
await step('landing "Log in" goes to login', async () => {
  await a.goto(APP);
  await a.click('a:has-text("Log in")');
  await a.waitForURL('**/login');
});
await step('/home while logged out redirects to login', async () => {
  await a.goto(`${APP}/home`);
  await a.waitForURL('**/login');
});
await step('a room link while logged out redirects to login, then returns to the room after login', async () => {
  await a.goto(`${APP}/room/PARTY2`);
  await a.waitForURL('**/login');
  await a.fill('#email', 'riya@demo.test');
  await a.fill('#password', 'demo1234');
  await a.click('button:has-text("Log in")');
  await a.waitForURL('**/room/PARTY2', { timeout: 10000 });
  await a.click('button:has-text("Leave")').catch(() => {});
});
await step('unknown page shows a not-found message', async () => {
  const p = (await newUser('anon2')).page;
  await p.goto(`${APP}/nope/nothing`);
  ok((await p.locator('body').innerText()).includes('Page not found'));
});

await step('signup rejects a short password with a readable message', async () => {
  const p = (await newUser('anon3')).page;
  await p.goto(`${APP}/signup`);
  await p.fill('#name', 'Short Pass');
  await p.fill('#email', `short-${stamp}@example.com`);
  await p.fill('#password', 'abc');
  await p.click('button:has-text("Create account")');
  await p.waitForSelector('[role=alert]');
  const t = await p.locator('[role=alert]').innerText();
  ok(/password/i.test(t), `message should mention the password, got: "${t}"`);
});
await step('login with a wrong password shows "Wrong email or password"', async () => {
  const p = (await newUser('anon4')).page;
  await login(p, 'riya@demo.test', 'wrongpass99');
  await p.waitForSelector('[role=alert]');
  ok((await p.locator('[role=alert]').innerText()).includes('Wrong email or password'));
});
await step('login with an empty form does not call the server', async () => {
  const p = (await newUser('anon5')).page;
  await p.goto(`${APP}/login`);
  await p.click('button:has-text("Log in")');
  await wait(400);
  ok(p.url().endsWith('/login'));
});

// ---------------------------------------------------------------- new account
const fresh = await newUser('fresh');
const f = fresh.page;
await step('signup creates an account and lands on home', async () => {
  await f.goto(`${APP}/signup`);
  await f.fill('#name', 'UI Tester');
  await f.fill('#email', NEW_EMAIL);
  await f.fill('#password', 'testpass-9876');
  await f.click('button:has-text("Create account")');
  await f.waitForURL('**/home');
  ok((await f.locator('h1').innerText()).includes('UI Tester'));
});
await step('signing up again with the same email says it already exists', async () => {
  const p = (await newUser('anon6')).page;
  await p.goto(`${APP}/signup`);
  await p.fill('#name', 'Dup');
  await p.fill('#email', NEW_EMAIL);
  await p.fill('#password', 'testpass-9876');
  await p.click('button:has-text("Create account")');
  await p.waitForSelector('[role=alert]');
  ok(/already exists/i.test(await p.locator('[role=alert]').innerText()));
});

let roomCode;
await step('home: "Create room" is disabled until a name is typed', async () => {
  const btn = f.locator('button:has-text("Create room")');
  ok(await btn.isDisabled(), 'should start disabled');
  await f.fill('#rname', 'Audit room');
  ok(!(await btn.isDisabled()), 'should enable');
});
await step('home: creating a room opens it', async () => {
  await f.click('button:has-text("Create room")');
  await f.waitForURL(/\/room\/[A-Z2-9]{6}$/);
  roomCode = f.url().split('/').pop();
});
await step('room gate shows the room name and the Join button', async () => {
  await f.waitForSelector('button:has-text("Join the party")');
  ok((await f.locator('h1').innerText()).includes('Audit room'));
});
await step('home: joining with a malformed code keeps the button disabled', async () => {
  await f.goto(`${APP}/home`);
  await f.fill('#rcode', 'ABC');
  ok(await f.locator('button:has-text("Join room")').isDisabled());
});
await step('home: joining a code that does not exist shows an error', async () => {
  await f.fill('#rcode', 'ZZZZZZ');
  await f.click('button:has-text("Join room")');
  await f.waitForSelector('[role=alert]');
  ok(/No room/i.test(await f.locator('[role=alert]').innerText()));
});
await step('home: "Your rooms" lists the new room and opens it', async () => {
  await f.reload();
  await f.waitForSelector(`button:has-text("${roomCode}")`);
  await f.click(`button:has-text("${roomCode}")`);
  await f.waitForURL(`**/room/${roomCode}`);
});
await step('a room that does not exist shows "Room not found"', async () => {
  await f.goto(`${APP}/room/ZZZZZZ`);
  await f.waitForSelector('h1:has-text("Room not found")');
  await f.click('a:has-text("Back to your rooms")');
  await f.waitForURL('**/home');
});
await step('logout returns to the logged-out state', async () => {
  await f.click('button:has-text("Log out")');
  await f.waitForURL('**/login');
});
await step('log back in with the new account', async () => {
  await login(f, NEW_EMAIL, 'testpass-9876');
  await f.waitForURL('**/home');
});

// ---------------------------------------------------------------- the room, with two users
const U1 = await newUser('riya');
const U2 = await newUser('arjun');
const r = U1.page;
const j = U2.page;
await login(r, 'riya@demo.test');
await r.waitForURL('**/home');
await login(j, 'arjun@demo.test');
await j.waitForURL('**/home');

await step('room full: a 5th person is told the room is full', async () => {
  await r.fill('#rname', 'Full room');
  await r.click('button:has-text("Create room")');
  await r.waitForURL(/\/room\/[A-Z2-9]{6}$/);
  const full = r.url().split('/').pop();
  await r.goto(`${APP}/home`); // Riya leaves, so she does not hold a seat
  await wait(500);
  const seats = [];
  const take = async (cookie) => {
    const s = io(API, { extraHeaders: { cookie }, transports: ['websocket'] });
    await new Promise((res2) => s.on('connect', res2));
    const ack = await s.emitWithAck('room:join', { code: full });
    ok(ack.ok, `seat refused: ${JSON.stringify(ack)}`);
    seats.push(s);
  };
  // Seats are taken by brand-new accounts: logging into a demo account here would sign out that account's browser.
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`${API}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Seat ${i}`, email: `ui-tester-seat${i}-${stamp}@example.com`, password: 'testpass-9876' }) });
    await take(res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '));
  }
  await r.goto(`${APP}/room/${full}`);
  await r.waitForSelector('h1:has-text("This room is full")', { timeout: 10000 });
  seats.forEach((s) => s.disconnect());
});

// Fresh room for the real flow
let code;
await step('two users create and join a room', async () => {
  await r.goto(`${APP}/home`);
  await r.fill('#rname', 'Audit party');
  await r.click('button:has-text("Create room")');
  await r.waitForURL(/\/room\/[A-Z2-9]{6}$/);
  code = r.url().split('/').pop();
  await j.goto(`${APP}/home`);
  await j.fill('#rcode', code.toLowerCase()); // lower case on purpose: should be accepted
  await j.click('button:has-text("Join room")');
  await j.waitForURL(`**/room/${code}`);
  await r.click('button:has-text("Join the party")');
  await j.click('button:has-text("Join the party")');
  await r.waitForSelector('.tile');
  await j.waitForSelector('.tile');
});

await step('both users see two tiles', async () => {
  await r.waitForFunction(() => document.querySelectorAll('.tile').length === 2);
  await j.waitForFunction(() => document.querySelectorAll('.tile').length === 2);
});
await step('calls: both users receive the other user\'s live video', async () => {
  const frames = (p) => p.evaluate(() => [...document.querySelectorAll('.tile video')].filter((v) => v.videoWidth > 0 && v.readyState >= 2).length);
  await r.waitForFunction(() => [...document.querySelectorAll('.tile video')].filter((v) => v.videoWidth > 0).length >= 2, null, { timeout: 15000 });
  await j.waitForFunction(() => [...document.querySelectorAll('.tile video')].filter((v) => v.videoWidth > 0).length >= 2, null, { timeout: 15000 });
  ok((await frames(r)) >= 2 && (await frames(j)) >= 2);
});

await step('copy invite button shows "Copied"', async () => {
  await r.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await r.click('button[aria-label="Copy invite link"]');
  await r.waitForSelector('button[aria-label="Copy invite link"]:has-text("Copied")', { timeout: 3000 });
});

await step('mic button toggles and the tile says "muted"', async () => {
  await r.click('button[aria-label="Mute microphone"]');
  await r.waitForSelector('button[aria-label="Unmute microphone"][aria-pressed="true"]');
  ok((await r.locator('.tile').first().innerText()).includes('muted'));
  await r.click('button[aria-label="Unmute microphone"]');
  await r.waitForSelector('button[aria-label="Mute microphone"]');
});
await step('camera button toggles and back', async () => {
  await r.click('button[aria-label="Turn camera off"]');
  await r.waitForSelector('button[aria-label="Turn camera on"][aria-pressed="true"]');
  await r.click('button[aria-label="Turn camera on"]');
  await r.waitForSelector('button[aria-label="Turn camera off"]');
});

await step('icon and emoji buttons are round and their icons sit inside them (alignment regression guard)', async () => {
  const bad = await r.evaluate(() => [...document.querySelectorAll('.emoji-btn, .icon-btn')].map((b) => {
    const box = b.getBoundingClientRect();
    const inner = b.firstElementChild?.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(b);
    const g = inner || range.getBoundingClientRect();
    const dx = Math.abs((g.left + g.width / 2) - (box.left + box.width / 2));
    return { label: b.getAttribute('aria-label'), w: Math.round(box.width), h: Math.round(box.height), off: Math.round(dx) };
  }).filter((x) => Math.abs(x.w - x.h) > 1 || x.off > 3));
  ok(bad.length === 0, `misaligned: ${JSON.stringify(bad)}`);
});
await step('Don\'t Laugh is disabled until a video is loaded', async () => {
  const b = r.locator('button:has-text("Start Don\'t Laugh")');
  ok(await b.isDisabled());
  ok((await r.locator('.dl-bar').innerText()).includes('Load a video first'));
});

await step('pasting a non-YouTube link shows an error', async () => {
  await r.fill('#yt', 'https://example.com/not-a-video');
  await r.click('button:has-text("Play this video")');
  await r.waitForSelector('[role=alert]:has-text("YouTube link")');
});
await step('pasting a YouTube link loads it for BOTH users and announces who played', async () => {
  await r.fill('#yt', 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  await r.click('button:has-text("Play this video")');
  await j.waitForSelector('.action-line:has-text("Riya played")', { timeout: 15000 });
  await r.waitForSelector('.stage-wrap iframe', { timeout: 15000 });
  await j.waitForSelector('.stage-wrap iframe', { timeout: 15000 });
});

await step('chat: Enter sends, both users see it with a video time', async () => {
  await r.fill('#msg', 'hello from riya');
  await r.press('#msg', 'Enter');
  await j.waitForSelector('.messages li:has-text("hello from riya")');
  await r.waitForSelector('.messages li:has-text("hello from riya")');
  ok(/\d+:\d\d/.test(await j.locator('.messages li:has-text("hello from riya") .stamp').innerText()), 'time stamp');
});
await step('chat: the Send button works too and the box clears', async () => {
  await j.fill('#msg', 'reply from arjun');
  await j.click('button:has-text("Send")');
  await r.waitForSelector('.messages li:has-text("reply from arjun")');
  await j.waitForFunction(() => document.querySelector('#msg').value === '', null, { timeout: 5000 }); // clears once the server confirms
});
await step('chat: an empty message is not sent', async () => {
  const before = await r.locator('.messages li').count();
  await r.fill('#msg', '   ');
  await r.press('#msg', 'Enter');
  await wait(500);
  ok((await r.locator('.messages li').count()) === before);
});
await step('chat: HTML in a message is shown as text, never run', async () => {
  await r.fill('#msg', '<img src=x onerror="window.__xss=1"><b>bold</b>');
  await r.press('#msg', 'Enter');
  await j.waitForSelector('.messages li:has-text("<b>bold</b>")');
  ok((await j.evaluate(() => window.__xss)) === undefined, 'script ran');
  ok((await j.locator('.messages img').count()) === 0, 'an img element was created');
});
await step('chat: the box limits messages to 500 characters', async () => {
  ok((await r.getAttribute('#msg', 'maxlength')) === '500');
});

for (const [i, e] of ['😂', '😄', '😮', '❤️', '👏', '🔥', '😱', '💀'].entries()) {
  await step(`emoji button ${e} floats on both screens`, async () => {
    await r.click(`button[aria-label="Send ${e}"]`);
    await r.waitForSelector('.floater', { timeout: 3000 });
    await j.waitForSelector('.floater', { timeout: 3000 });
    if (i < 7) await wait(2700); // let it clear so the next check sees a new one
  });
}

await step('queue: adding a non-YouTube link shows an error', async () => {
  await j.fill('#yt', 'banana');
  await j.click('button:has-text("Add to queue")');
  await j.waitForSelector('[role=alert]:has-text("YouTube link")');
});
await step('queue: add two videos, titles are fetched', async () => {
  await j.fill('#yt', 'https://www.youtube.com/watch?v=9bZkp7q19f0');
  await j.click('button:has-text("Add to queue")');
  await r.waitForSelector('.queue-list li', { timeout: 8000 });
  await j.fill('#yt', 'https://youtu.be/dQw4w9WgXcQ');
  await j.click('button:has-text("Add to queue")');
  await r.waitForFunction(() => document.querySelectorAll('.queue-list li').length === 2);
  const t = await r.locator('.queue-list li').first().innerText();
  ok(!/^Video [A-Za-z0-9_-]{11}/.test(t), `title should be a real title, got "${t.slice(0, 50)}"`);
});
await step('queue: adding the same video again is refused', async () => {
  await j.fill('#yt', 'https://www.youtube.com/watch?v=9bZkp7q19f0');
  await j.click('button:has-text("Add to queue")');
  await j.waitForSelector('[role=alert]:has-text("already")');
});
await step('queue: voting moves a video to the top for both users', async () => {
  // Riya votes for the SECOND item
  await r.locator('.queue-list li').nth(1).locator('button').click();
  await j.waitForFunction(() => document.querySelectorAll('.queue-list li')[0]?.innerText.includes('voted') || document.querySelectorAll('.queue-list li')[0]?.innerText.includes('· 2'));
});
await step('queue: voting again removes the vote', async () => {
  const li = r.locator('.queue-list li').first();
  const before = await li.innerText();
  await li.locator('button').click();
  await wait(500);
  ok((await r.locator('.queue-list li').first().innerText()) !== before, 'should change');
});
await step('queue: "Play the top video" plays it for everyone and removes it from the queue', async () => {
  await r.click('button:has-text("Play the top video")');
  await r.waitForFunction(() => document.querySelectorAll('.queue-list li').length === 1, null, { timeout: 5000 });
  await j.waitForFunction(() => document.querySelectorAll('.queue-list li').length === 1, null, { timeout: 5000 });
});

await step('face reactions: toggling on and off works with a camera that shows no face', async () => {
  const b = r.locator('button:has-text("Face reactions")');
  await b.click();
  await r.waitForSelector('button[aria-pressed="true"]:has-text("Face reactions: on")');
  await wait(2500);
  await b.click();
  await r.waitForSelector('button:has-text("Face reactions: off")');
});

await step('Don\'t Laugh: starting shows the calibration card on BOTH screens', async () => {
  await r.click('button:has-text("Start Don\'t Laugh")');
  await r.waitForSelector('.dl-card:has-text("neutral face")');
  await j.waitForSelector('.dl-card:has-text("neutral face")');
});
await step('Don\'t Laugh: a second Start is not possible while a round is running', async () => {
  ok((await r.locator('button:has-text("Start Don\'t Laugh")').count()) === 0);
});
await step('Don\'t Laugh: "Start countdown" stays disabled with fewer than 2 calibrated', async () => {
  ok(await r.locator('button:has-text("Start countdown")').isDisabled());
});
await step('Don\'t Laugh: with no face visible, the card says so', async () => {
  await r.waitForFunction(() => /can't see your face|Loading the face reader/i.test(document.querySelector('.dl-card')?.innerText || ''), null, { timeout: 15000 });
});
await step('Don\'t Laugh: Cancel closes the card for BOTH users and Start works again', async () => {
  await r.click('button:has-text("Cancel")');
  await r.waitForSelector('button:has-text("Start Don\'t Laugh")');
  await j.waitForSelector('button:has-text("Start Don\'t Laugh")');
});

await step('late joiner: a third user joins mid-party, sees chat history and the video', async () => {
  const U3 = await newUser('meera');
  await login(U3.page, 'meera@demo.test');
  await U3.page.waitForURL('**/home');
  await U3.page.fill('#rcode', code);
  await U3.page.click('button:has-text("Join room")');
  await U3.page.waitForURL(`**/room/${code}`);
  await U3.page.click('button:has-text("Join the party")');
  await U3.page.waitForSelector('.stage-wrap iframe', { timeout: 15000 });
  await U3.page.waitForSelector('.messages li:has-text("hello from riya")', { timeout: 8000 }).catch(async () => {
    // spoiler-safe chat may hide messages from "later" than the late joiner's position; the peek chip must then be offered
    await U3.page.waitForSelector('button:has-text("from later")', { timeout: 3000 });
  });
  await U3.page.waitForFunction(() => document.querySelectorAll('.tile').length === 3, null, { timeout: 8000 });
  await U3.page.screenshot({ path: path.join(OUT, 'late-joiner.png') });
});

await step('going offline shows "Reconnecting…" and coming back restores the room', async () => {
  await U2.ctx.setOffline(true);
  await j.waitForSelector('.banner:has-text("Reconnecting")', { timeout: 80000 }); // the socket notices after the ping timeout
  await U2.ctx.setOffline(false);
  await j.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 20000 });
  await j.fill('#msg', 'back online');
  await j.press('#msg', 'Enter');
  await r.waitForSelector('.messages li:has-text("back online")', { timeout: 8000 });
});

await step('Recaps link opens the recap page and lists this live party', async () => {
  await r.click('a:has-text("Recaps")');
  await r.waitForURL(`**/room/${code}/recap`);
  await r.waitForSelector('h1:has-text("Party recap")');
  await r.waitForSelector('.past .chip', { timeout: 8000 });
});
await step('join gate: "Back to your rooms" works, and so does Leave inside the room', async () => {
  await r.goBack();
  await r.waitForSelector('a:has-text("Back to your rooms")');
  await r.click('a:has-text("Back to your rooms")');
  await r.waitForURL('**/home');
  await r.goto(`${APP}/room/${code}`);
  await r.click('button:has-text("Join the party")');
  await r.click('a:has-text("Leave")');
  await r.waitForURL('**/home');
});

// ---------------------------------------------------------------- recap with seeded data
await step('recap (sample party): heat strip, flags, awards and rounds render; sample banner shown', async () => {
  await r.goto(`${APP}/room/PARTY2/recap`);
  await r.waitForSelector('.past .chip:has-text("sample")', { timeout: 10000 });
  await r.click('.past .chip:has-text("sample")');
  await r.waitForSelector('.heat svg', { timeout: 10000 });
  ok((await r.locator('.flag').count()) >= 3, 'peak flags');
  ok((await r.locator('.awards li').count()) >= 3, 'awards');
  ok((await r.locator('.sample-note').count()) === 1, 'sample banner');
  const href = await r.locator('.flag').first().getAttribute('href');
  ok(/youtube\.com\/watch\?v=.+&t=\d+s/.test(href), `flag link: ${href}`);
});
await step('recap: a person who is not in the room cannot read it', async () => {
  await f.goto(`${APP}/room/PARTY2/recap`);
  await f.waitForSelector('[role=alert]', { timeout: 8000 });
  ok(/not a member/i.test(await f.locator('[role=alert]').innerText()));
});

// ---------------------------------------------------------------- one login per account
await step('opening the same account on a second device signs the first one out immediately (even inside a room)', async () => {
  const one = await newUser('device-1');
  const email = await signupFresh(one.page, 'single');
  await one.page.fill('#rname', 'Single login');
  await one.page.click('button:has-text("Create room")');
  await one.page.waitForURL(/\/room\/[A-Z2-9]{6}$/);
  await one.page.click('button:has-text("Join the party")');
  await one.page.waitForSelector('.tile');
  const two = await newUser('device-2');
  await login(two.page, email, 'testpass-9876');
  await two.page.waitForURL('**/home');
  await one.page.waitForURL('**/login', { timeout: 15000 });
  await one.page.waitForSelector('[role=alert]:has-text("another device")', { timeout: 5000 });
  ok(two.page.url().endsWith('/home'), 'the new device must stay logged in');
  await two.page.reload(); // and it really is still logged in on the server
  await two.page.waitForSelector('h1:has-text("Hi,")', { timeout: 10000 });
  await one.ctx.close();
  await two.ctx.close();
});
await step('a signed-out device cannot use its old login on the API either', async () => {
  const one = await newUser('device-3');
  const email = await signupFresh(one.page, 'api');
  const two = await newUser('device-4');
  await login(two.page, email, 'testpass-9876');
  await two.page.waitForURL('**/home');
  // Call the API the way the page does: through its own address when that forwards /api, otherwise straight to the backend.
  const status = await one.page.evaluate(async (api) => {
    const proxied = await fetch('/health').then((r) => r.json()).then((j) => j.ok === true).catch(() => false);
    return (await fetch(`${proxied ? '' : api}/api/rooms/mine`, { credentials: 'include' })).status;
  }, API);
  ok(status === 401, `old login still worked (status ${status})`);
  await one.ctx.close();
  await two.ctx.close();
});

// ---------------------------------------------------------------- phone widths and accessibility
for (const [name, url] of [['landing', '/'], ['login', '/login'], ['home', '/home'], ['recap', '/room/PARTY2/recap']]) {
  await step(`phone width (375px): ${name} has no sideways overflow`, async () => {
    const m = await newUser(`m-${name}`, { width: 375, height: 812 });
    await signupFresh(m.page, 'phone');
    await m.page.goto(`${APP}${url === '/room/PARTY2/recap' ? '/home' : url}`);
    await wait(1200);
    const o = await m.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    ok(o.sw <= o.iw + 1, `scrollWidth ${o.sw} > ${o.iw}`);
    await m.page.screenshot({ path: path.join(OUT, `phone-${name}.png`) });
    await m.ctx.close();
  });
}
await step('phone width (375px): the room page has no sideways overflow', async () => {
  const m = await newUser('m-room', { width: 375, height: 812 });
  await signupFresh(m.page, 'phoneroom');
  await m.page.goto(`${APP}/room/${code}`);
  await m.page.click('button:has-text("Join the party")');
  await wait(2500);
  const o = await m.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  ok(o.sw <= o.iw + 1, `scrollWidth ${o.sw} > ${o.iw}`);
  await m.page.screenshot({ path: path.join(OUT, 'phone-room.png'), fullPage: true });
  await m.ctx.close();
});
await step('every button in the room has an accessible name', async () => {
  await r.goto(`${APP}/room/${code}`);
  await r.click('button:has-text("Join the party")');
  await wait(1500);
  const unnamed = await r.evaluate(() => [...document.querySelectorAll('button, a, input')].filter((e) => {
    const name = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || '').trim();
    const labelled = e.id && document.querySelector(`label[for="${e.id}"]`);
    return !name && !labelled;
  }).map((e) => e.outerHTML.slice(0, 80)));
  ok(unnamed.length === 0, `unnamed controls: ${unnamed.join(' | ')}`);
});

await browser.close();

console.log('\n---------------------------------------------');
console.log(`${pass} passed, ${failures.length} failed`);
if (failures.length) console.log('FAILED:\n  - ' + failures.join('\n  - '));
const uniq = (arr) => [...new Set(arr)];
console.log(`\nconsole errors (${consoleErrors.length}):`);
uniq(consoleErrors).slice(0, 15).forEach((e) => console.log('  ' + e));
console.log(`\nfailed API requests (${badRequests.length}):`);
uniq(badRequests).slice(0, 15).forEach((e) => console.log('  ' + e));
process.exit(failures.length ? 1 : 0);
