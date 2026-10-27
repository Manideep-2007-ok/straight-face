// npm run seed            -> 3 demo users, 1 room, 1 sample party (synthetic data, labelled "sample")
// npm run seed -- --clean -> also deletes throwaway test users created by scripts/e2e.mjs
import bcrypt from 'bcryptjs';
import { parseConfig } from '../config/index.js';
import { connectDb, disconnectDb } from '../db/connect.js';
import { User, Room, PartySession, ReactionEvent, GameRound, ChatMessage } from '../models/index.js';

const config = parseConfig();
await connectDb(config.dbURL, config.DB_NAME);

if (process.argv.includes('--clean')) {
  const gone = await User.deleteMany({ email: /^(e2e-|ui-tester-|load-).*@example\.com$/ });
  console.log(`Removed ${gone.deletedCount} test users.`);
}

const PASSWORD = 'demo1234';
const demo = [
  { name: 'Riya', email: 'riya@demo.test' },
  { name: 'Arjun', email: 'arjun@demo.test' },
  { name: 'Meera', email: 'meera@demo.test' },
];
const hash = await bcrypt.hash(PASSWORD, 10);
const users = [];
for (const d of demo) {
  users.push(await User.findOneAndUpdate({ email: d.email }, { name: d.name, passwordHash: hash }, { upsert: true, returnDocument: 'after' }));
}

// Earlier versions used an invalid code (DEMO42 has an O); remove that room and its sample parties.
const stale = await Room.findOne({ code: 'DEMO42' });
if (stale) {
  const ss = await PartySession.find({ roomId: stale._id });
  for (const x of ss) {
    await Promise.all([ReactionEvent.deleteMany({ sessionId: x._id }), GameRound.deleteMany({ sessionId: x._id }), ChatMessage.deleteMany({ sessionId: x._id })]);
    await x.deleteOne();
  }
  await stale.deleteOne();
}

const room = await Room.findOneAndUpdate(
  { code: 'PARTY2' },
  { name: 'Demo room', hostId: users[0]._id, memberIds: users.map((u) => u._id) },
  { upsert: true, returnDocument: 'after' },
);

// Replace any previous sample party for this room.
const old = await PartySession.find({ roomId: room._id, sample: true });
for (const s of old) {
  await Promise.all([ReactionEvent.deleteMany({ sessionId: s._id }), GameRound.deleteMany({ sessionId: s._id }), ChatMessage.deleteMany({ sessionId: s._id })]);
  await s.deleteOne();
}

const VIDEO = 'dQw4w9WgXcQ';
const LEN = 213;
const start = new Date(Date.now() - 3 * 3600 * 1000);
const session = await PartySession.create({
  roomId: room._id,
  startedAt: start,
  endedAt: new Date(start.getTime() + LEN * 1000),
  participants: users.map((u) => ({ userId: u._id, name: u.name })),
  videos: [{ videoId: VIDEO, title: 'Sample video', startedAtT: 0, endedAtT: LEN }],
  duration: LEN,
  sample: true,
});

// Deterministic "random" so the sample looks the same every time (mulberry32).
let a = 1234567;
const rnd = () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const events = [];
const bursts = [32, 75, 130, 181];
for (const u of users) {
  for (const b of bursts) {
    for (let k = -3; k <= 3; k++) {
      if (rnd() < 0.7) events.push({ sessionId: session._id, userId: u._id, kind: 'laugh', videoId: VIDEO, t: b + k, strength: Math.round((0.4 + rnd() * 0.55) * 100) / 100, source: 'seed' });
    }
  }
}
events.push({ sessionId: session._id, userId: users[1]._id, kind: 'surprise', videoId: VIDEO, t: 75, strength: 0.8, source: 'seed' });
events.push({ sessionId: session._id, userId: users[1]._id, kind: 'surprise', videoId: VIDEO, t: 130, strength: 0.7, source: 'seed' });
events.push({ sessionId: session._id, userId: users[2]._id, kind: 'emoji', emoji: '🔥', videoId: VIDEO, t: 90, strength: 0, source: 'seed' });
await ReactionEvent.insertMany(events);

await GameRound.create({
  sessionId: session._id,
  videoId: VIDEO,
  config: { baselineSec: 3, smileThreshold: 0.35, holdFrames: 3 },
  startedAt: start,
  endedAt: new Date(start.getTime() + 100 * 1000),
  outcomes: [
    { userId: users[1]._id, name: 'Arjun', outAtT: 29, peak: 0.82 },
    { userId: users[0]._id, name: 'Riya', outAtT: 76, peak: 0.9 },
    { userId: users[2]._id, name: 'Meera', outAtT: null, peak: 0.2 },
  ],
  winners: [users[2]._id],
});

await ChatMessage.insertMany([
  { sessionId: session._id, userId: users[0]._id, name: 'Riya', text: 'ok that intro again', videoId: VIDEO, t: 12 },
  { sessionId: session._id, userId: users[1]._id, name: 'Arjun', text: 'I cannot', videoId: VIDEO, t: 33 },
  { sessionId: session._id, userId: users[2]._id, name: 'Meera', text: 'here it comes', videoId: VIDEO, t: 74 },
  { sessionId: session._id, userId: users[0]._id, name: 'Riya', text: 'HA', videoId: VIDEO, t: 76 },
  { sessionId: session._id, userId: users[1]._id, name: 'Arjun', text: 'dead', videoId: VIDEO, t: 78 },
]);

console.log('Seeded. Log in as riya@demo.test / arjun@demo.test / meera@demo.test, password:', PASSWORD);
console.log(`Room code PARTY2, sample party id ${session._id}`);
await disconnectDb();
