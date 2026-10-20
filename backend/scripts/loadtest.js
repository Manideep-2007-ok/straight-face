// Load test: 4 socket clients in one room, each sends EVENTS_PER_SEC events for SECONDS seconds.
// Prints p50/p95 fan-out latency (time from emit to the other clients receiving it) and checks the room survives.
// Usage: BASE=http://localhost:4000 node scripts/loadtest.js   (creates throwaway users named load-*)
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://localhost:4000';
const SECONDS = Number(process.env.SECONDS || 30);
const EVENTS_PER_SEC = Number(process.env.EVENTS_PER_SEC || 20);
const stamp = Date.now();

async function signup(i) {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Load ${i}`, email: `load-${stamp}-${i}@example.com`, password: 'password123' }),
  });
  if (res.status !== 201) throw new Error(`signup ${i} failed: ${res.status}`);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const connect = (cookie) =>
  new Promise((resolve, reject) => {
    const s = io(BASE, { extraHeaders: { cookie }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : NaN);

const cookies = [];
for (let i = 0; i < 4; i++) cookies.push(await signup(i));
const room = await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookies[0] }, body: JSON.stringify({ name: 'Load test' }) }).then((r) => r.json());
const code = room.data.code;

const socks = [];
for (const c of cookies) {
  const s = await connect(c);
  const ack = await s.emitWithAck('room:join', { code });
  if (!ack.ok) throw new Error(`join failed: ${JSON.stringify(ack)}`);
  socks.push(s);
}

// Chat is bursty-limited by design, so use radar samples (30/s bucket) and seeks to generate fan-out.
// Latency: client 0 seeks to a unique position; clients 1..3 record when they see that exact position.
const latencies = [];
const sent = new Map();
for (let i = 1; i < socks.length; i++) {
  socks[i].on('play:state', (st) => {
    const t0 = sent.get(st.position);
    if (t0) latencies.push(Date.now() - t0);
  });
}
let rejected = 0;
let counter = 0;
const interval = 1000 / EVENTS_PER_SEC;
const end = Date.now() + SECONDS * 1000;
const tick = setInterval(async () => {
  if (Date.now() >= end) return;
  const pos = ++counter + 0.5;
  sent.set(pos, Date.now());
  const r = await socks[0].timeout(3000).emitWithAck('play:seek', { position: pos }).catch(() => ({ error: 'TIMEOUT' }));
  if (r.error) rejected++;
  // the other three also send traffic
  for (let i = 1; i < socks.length; i++) socks[i].emit('radar:sample', { t: counter, smile: Math.random() * 0.3, surprise: 0 });
}, interval);

await new Promise((r) => setTimeout(r, SECONDS * 1000 + 1500));
clearInterval(tick);

latencies.sort((a, b) => a - b);
const stillThere = socks.every((s) => s.connected);
console.log(`events sent by client 0: ${counter}, rejected/timeouts: ${rejected}`);
console.log(`fan-out samples: ${latencies.length}`);
console.log(`latency ms  p50=${pct(latencies, 50)}  p95=${pct(latencies, 95)}  max=${latencies.at(-1)}`);
console.log(`all 4 clients still connected: ${stillThere}`);
socks.forEach((s) => s.disconnect());
process.exit(stillThere ? 0 : 1);
