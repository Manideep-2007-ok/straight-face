import test from 'node:test';
import assert from 'node:assert/strict';
import { initialPlayback, expectedPosition, applyAction } from '../logic/playbackState.js';
import { RateBucket } from '../logic/rateBucket.js';

const ctx = (now, lastToggleAt = 0) => ({ userId: 'u1', name: 'Riya', now, lastToggleAt });

test('expectedPosition: paused stays, playing advances with server time', () => {
  const s = { ...initialPlayback('abcdefghijk', 1000), position: 10 };
  assert.equal(expectedPosition(s, 5000), 10);
  assert.equal(expectedPosition({ ...s, status: 'playing' }, 5000), 14);
});

test('play then pause: version increments and by/byName are recorded', () => {
  let s = initialPlayback('abcdefghijk', 0);
  let r = applyAction(s, { kind: 'set', status: 'playing', position: 0 }, ctx(1000));
  assert.equal(r.accepted, true);
  assert.equal(r.state.version, 1);
  assert.equal(r.state.byName, 'Riya');
  r = applyAction(r.state, { kind: 'set', status: 'paused', position: 5 }, ctx(5000, r.toggledAt));
  assert.equal(r.accepted, true);
  assert.equal(r.state.status, 'paused');
  assert.equal(r.state.version, 2);
});

test('cooldown: same user toggling again within 700 ms is rejected', () => {
  let s = initialPlayback('abcdefghijk', 0);
  const first = applyAction(s, { kind: 'set', status: 'playing', position: 0 }, ctx(1000));
  const second = applyAction(first.state, { kind: 'set', status: 'paused', position: 0.3 }, ctx(1300, first.toggledAt));
  assert.equal(second.accepted, false);
  assert.equal(second.reason, 'COOLDOWN');
  assert.equal(second.state.version, 1);
});

test('echo: setting the same status near the expected position is a no-op', () => {
  const s = applyAction(initialPlayback('abcdefghijk', 0), { kind: 'set', status: 'playing', position: 0 }, ctx(1000)).state;
  const r = applyAction(s, { kind: 'set', status: 'playing', position: 2.2 }, { ...ctx(3000), userId: 'u2' });
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'NOOP');
});

test('seek keeps status, sets position, bumps version; negative clamps to 0', () => {
  const s = applyAction(initialPlayback('abcdefghijk', 0), { kind: 'set', status: 'playing', position: 0 }, ctx(1000)).state;
  const r = applyAction(s, { kind: 'seek', position: 42 }, ctx(2000));
  assert.equal(r.state.status, 'playing');
  assert.equal(r.state.position, 42);
  assert.equal(r.state.version, 2);
  assert.equal(applyAction(s, { kind: 'seek', position: -5 }, ctx(2000)).state.position, 0);
});

test('changing video resets position to 0 when none is given', () => {
  const s = { ...initialPlayback('aaaaaaaaaaa', 0), position: 99 };
  const r = applyAction(s, { kind: 'set', status: 'playing', videoId: 'bbbbbbbbbbb' }, ctx(1000));
  assert.equal(r.state.videoId, 'bbbbbbbbbbb');
  assert.equal(r.state.position, 0);
});

test('rate bucket: burst then refill', () => {
  let t = 0;
  const b = new RateBucket(5, 30, () => t);
  for (let i = 0; i < 5; i++) assert.equal(b.take(), true);
  assert.equal(b.take(), false);
  t += 100; // 3 tokens
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
});
