// Live end-to-end check against a running server (default http://localhost:4000).
// Creates throwaway users named e2e-*. Run: node scripts/e2e.mjs
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://localhost:4000';
const stamp = Date.now();
let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failed++;
};

async function signup(i) {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `E2E ${i}`, email: `e2e-${stamp}-${i}@example.com`, password: 'password123' }),
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, cookie, body: await res.json() };
}

const api = async (path, cookie, method = 'GET', body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};

const connect = (cookie) =>
  new Promise((resolve, reject) => {
    const s = io(BASE, { extraHeaders: { cookie }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const users = [];
for (let i = 0; i < 5; i++) users.push(await signup(i));
check('signup returns 201 and a cookie', users.every((u) => u.status === 201 && u.cookie.includes('token=')));

const dup = await fetch(`${BASE}/api/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'x', email: `e2e-${stamp}-0@example.com`, password: 'password123' }),
});
check('duplicate email gives 409', dup.status === 409);

const bad = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `e2e-${stamp}-0@example.com`, password: 'wrongpass1' }),
});
check('wrong password gives 401', bad.status === 401);

const me = await api('/api/auth/me', users[0].cookie);
check('/me returns the user', me.json.data?.name === 'E2E 0');

const created = await api('/api/rooms', users[0].cookie, 'POST', { name: 'E2E room' });
const code = created.json.data?.code;
check('create room returns a 6-char code', created.status === 201 && /^[A-Z2-9]{6}$/.test(code), code);
check('GET room public info', (await api(`/api/rooms/${code}`, '')).json.data?.name === 'E2E room');
check('unknown room is 404', (await api('/api/rooms/ZZZZZZ', '')).status === 404);
check('my rooms lists it', (await api('/api/rooms/mine', users[0].cookie)).json.data.some((r) => r.code === code));

const noAuth = await connect('').then(() => 'connected', (e) => e.message);
check('socket without cookie is rejected', noAuth === 'auth_error', noAuth);

const sockets = [];
for (let i = 0; i < 4; i++) sockets.push(await connect(users[i].cookie));
const acks = [];
for (const s of sockets) acks.push(await s.emitWithAck('room:join', { code }));
check('4 users join the room', acks.every((a) => a.ok));
const fifth = await (await connect(users[4].cookie)).emitWithAck('room:join', { code });
check('5th user gets ROOM_FULL', fifth.error === 'ROOM_FULL');

const ping = await sockets[0].emitWithAck('clock:ping', { c: 1 });
check('clock ping returns server time', Math.abs(ping.s - Date.now()) < 2000);

const got = (s, ev) => new Promise((r) => s.once(ev, r));

// user 1 plays; user 3 must receive it
const seen = got(sockets[2], 'play:state');
const t0 = Date.now();
const play = await sockets[1].emitWithAck('play:set', { videoId: 'dQw4w9WgXcQ', status: 'playing', position: 0 });
const st = await seen;
check('play from user 1 reaches user 3', st.status === 'playing' && st.byName === 'E2E 1', `${Date.now() - t0} ms`);
check('version incremented', play.state.version === 1);

await wait(800);
const pausedP = got(sockets[0], 'play:state');
await sockets[2].emitWithAck('play:set', { status: 'paused' });
const ps = await pausedP;
check('anyone can pause (user 3 paused, user 0 sees it)', ps.status === 'paused' && ps.byName === 'E2E 2');

const cd = await sockets[2].emitWithAck('play:set', { status: 'playing' });
check('rapid re-toggle by same user is blocked (cooldown)', cd.ok === false && cd.reason === 'COOLDOWN');

const seekP = got(sockets[3], 'play:state');
await sockets[0].emitWithAck('play:seek', { position: 42 });
check('seek is broadcast', (await seekP).position === 42);

const badEv = await sockets[0].emitWithAck('play:set', { status: 'playing', videoId: 'nope' });
check('invalid video id rejected', badEv.error === 'BAD_PAYLOAD');

const chatP = got(sockets[3], 'chat:new');
await sockets[1].emitWithAck('chat:send', { text: 'hello <b>there</b>' });
const msg = await chatP;
check('chat delivered with video time stamp', msg.text === 'hello <b>there</b>' && msg.t === 42 && msg.name === 'E2E 1');

// a late joiner gets current state + recent chat
sockets[3].disconnect();
await wait(200);
const late = await (await connect(users[3].cookie)).emitWithAck('room:join', { code });
check('late joiner gets state and chat history', late.state.position === 42 && late.chat.length === 1);

// RTC relay: only to room members
const sigP = got(sockets[1], 'rtc:signal');
await sockets[0].emitWithAck('rtc:signal', { to: me.json.data.id === users[1].body.data.id ? 'x' : users[1].body.data.id, type: 'offer', payload: { sdp: 'x' } });
check('rtc signal relayed to a room member', (await sigP).type === 'offer');
check('rtc signal to a non-member fails', (await sockets[0].emitWithAck('rtc:signal', { to: users[4].body.data.id, type: 'offer', payload: {} })).error === 'NOT_FOUND');


// ---- Don't Laugh round ----
const g = await api('/api/rooms', users[0].cookie, 'POST', { name: 'E2E game' });
const gcode = g.json.data.code;
const gs = [];
for (let i = 0; i < 3; i++) {
  const s = await connect(users[i].cookie);
  await s.emitWithAck('room:join', { code: gcode });
  gs.push(s);
}
const noVideo = await gs[0].emitWithAck('dl:start', {});
check('cannot start a round without a video', noVideo.error === 'NO_VIDEO');
await gs[0].emitWithAck('play:set', { videoId: 'dQw4w9WgXcQ', status: 'paused', position: 0 });
const states = [];
gs[2].on('dl:state', (st) => states.push(st));
check('start round', (await gs[0].emitWithAck('dl:start', {})).ok === true);
check('second start is refused while active', (await gs[1].emitWithAck('dl:start', {})).error === 'ROUND_ACTIVE');
check('begin needs 2 calibrated', (await gs[0].emitWithAck('dl:begin')).error === 'NEED_PLAYERS');
for (const s of gs) await s.emitWithAck('dl:calibrated', { threshold: 0.4 });
const begun = Date.now();
check('begin countdown', (await gs[0].emitWithAck('dl:begin')).ok === true);
await wait(5300);
check('round went live after ~5 s', states.some((x) => x.phase === 'live'), `${Date.now() - begun} ms`);
const outA = await gs[0].emitWithAck('dl:out', { t: 0.5, peak: 0.8 });
check('player 0 goes out', outA.ok === true);
check('out is idempotent', (await gs[0].emitWithAck('dl:out', { t: 0.6, peak: 0.9 })).ok === false);
check('bad timestamp is rejected', (await gs[1].emitWithAck('dl:out', { t: 900, peak: 0.9 })).reason === 'BAD_TIME');
await gs[1].emitWithAck('dl:out', { t: 1.0, peak: 0.7 });
await wait(300);
const final = states.at(-1);
check('last straight face (player 2) wins', final.phase === 'ended' && final.winners[0] === users[2].body.data.id, JSON.stringify(final.winners));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
