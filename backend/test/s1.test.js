import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../config/index.js';
import { generateRoomCode, ROOM_CODE_RE } from '../utils/roomCode.js';
import { RoomRegistry } from '../state/roomRegistry.js';

const goodEnv = { dbURL: 'mongodb://x', JWT_SECRET: 'a'.repeat(16) };

test('config: accepts a valid env and strips trailing slash from CLIENT_URL', () => {
  const c = parseConfig({ ...goodEnv, CLIENT_URL: 'https://app.vercel.app/' });
  assert.equal(c.PORT, 4000);
  assert.deepEqual(c.allowedOrigins, ['https://app.vercel.app', 'http://localhost:5173']);
  assert.equal(c.isProd, false);
});

test('config: CLIENT_URL can list several frontends', () => {
  const c = parseConfig({ ...goodEnv, CLIENT_URL: 'https://a.onrender.com/, https://b.vercel.app' });
  assert.deepEqual(c.allowedOrigins, ['https://a.onrender.com', 'https://b.vercel.app', 'http://localhost:5173']);
});

test('config: finds the database address under a differently written name, and never prints its value', () => {
  const c = parseConfig({ JWT_SECRET: 'a'.repeat(16), DBURL: 'mongodb://secret-host/x' });
  assert.equal(c.dbURL, 'mongodb://secret-host/x');
  assert.equal(parseConfig({ JWT_SECRET: 'a'.repeat(16), Mongodb_Uri: ' mongodb://h/y ' }).dbURL, 'mongodb://h/y');
  try {
    parseConfig({ JWT_SECRET: 'a'.repeat(16), my_db_thing: 'mongodb://secret-host/x' });
    assert.fail('should throw');
  } catch (e) {
    assert.match(e.message, /my_db_thing/); // the NAME is shown to help debugging
    assert.doesNotMatch(e.message, /secret-host/); // the value never is
  }
});

test('config: rejects missing dbURL and a short JWT_SECRET', () => {
  assert.throws(() => parseConfig({ JWT_SECRET: 'a'.repeat(16) }), /dbURL/);
  assert.throws(() => parseConfig({ dbURL: 'x', JWT_SECRET: 'short' }), /JWT_SECRET/);
});

test('room codes: 6 chars, no confusing letters, mostly unique', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const code = generateRoomCode();
    assert.match(code, ROOM_CODE_RE);
    assert.doesNotMatch(code, /[01OIL]/);
    seen.add(code);
  }
  assert.ok(seen.size > 490);
});

test('registry: room holds at most 4 members', () => {
  const reg = new RoomRegistry(4);
  for (let i = 0; i < 4; i++) {
    assert.equal(reg.join('ABC234', { userId: `u${i}`, name: `U${i}` }, `s${i}`).ok, true);
  }
  const fifth = reg.join('ABC234', { userId: 'u4', name: 'U4' }, 's4');
  assert.deepEqual(fifth, { ok: false, error: 'ROOM_FULL' });
  assert.equal(reg.memberCount('ABC234'), 4);
});

test('registry: simultaneous joins for the last seat give exactly one winner', async () => {
  const reg = new RoomRegistry(4);
  for (let i = 0; i < 3; i++) reg.join('R', { userId: `u${i}`, name: 'x' }, `s${i}`);
  const results = await Promise.all(
    ['a', 'b', 'c', 'd'].map((id) => Promise.resolve().then(() => reg.join('R', { userId: id, name: id }, id))),
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(reg.memberCount('R'), 4);
});

test('registry: same user rejoining keeps one seat; stale socket cannot remove the new seat', () => {
  const reg = new RoomRegistry(4);
  reg.join('R', { userId: 'u1', name: 'A' }, 'old');
  reg.join('R', { userId: 'u1', name: 'A' }, 'new');
  assert.equal(reg.memberCount('R'), 1);
  assert.equal(reg.leave('R', 'u1', 'old'), false);
  assert.equal(reg.memberCount('R'), 1);
  assert.equal(reg.leave('R', 'u1', 'new'), true);
  assert.equal(reg.memberCount('R'), 0);
});
