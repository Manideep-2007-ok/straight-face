// A second user for testing the UI by hand. Logs in as a seeded demo user, joins a room, and obeys commands
// appended to a file. Needs `npm run seed` first.
//   BOT_CMD=/path/cmd.txt node scripts/bot.mjs ROOMCODE [email]
//   echo "play dQw4w9WgXcQ" >> /path/cmd.txt      commands: play ID | pause | resume | seek N | chat TEXT | emoji X | queue ID | next
import { io } from 'socket.io-client';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4000';
const CMD = process.env.BOT_CMD || './bot-cmd.txt';
const code = process.argv[2];
const email = process.argv[3] || 'arjun@demo.test';
if (!code) throw new Error('usage: node scripts/bot.mjs ROOMCODE [email]');

const res = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'demo1234' }),
});
if (!res.ok) throw new Error(`login failed ${res.status}`);
const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const s = io(BASE, { extraHeaders: { cookie }, transports: ['websocket'] });
await new Promise((r) => s.on('connect', r));
const ack = await s.emitWithAck('room:join', { code });
console.log('joined', code, ack.ok ? 'ok' : ack.error);
s.on('play:state', (st) => console.log('state', st.status, Math.round(st.position), 'by', st.byName));
s.on('chat:new', (m) => console.log('chat', m.name, m.text));

writeFileSync(CMD, '');
let done = 0;
setInterval(async () => {
  if (!existsSync(CMD)) return;
  const lines = readFileSync(CMD, 'utf8').split('\n').filter(Boolean);
  for (; done < lines.length; done++) {
    const [c, ...rest] = lines[done].split(' ');
    const arg = rest.join(' ');
    const r = await ({
      play: () => s.emitWithAck('play:set', { videoId: arg, status: 'playing', position: 0 }),
      pause: () => s.emitWithAck('play:set', { status: 'paused' }),
      resume: () => s.emitWithAck('play:set', { status: 'playing' }),
      seek: () => s.emitWithAck('play:seek', { position: Number(arg) }),
      chat: () => s.emitWithAck('chat:send', { text: arg }),
      emoji: () => s.emitWithAck('react:emoji', { emoji: arg }),
      queue: () => s.emitWithAck('queue:add', { videoId: arg }),
      next: () => s.emitWithAck('queue:next'),
    }[c] || (async () => ({ error: 'UNKNOWN_COMMAND' })))();
    console.log('>', lines[done], '->', JSON.stringify(r));
  }
}, 300);
