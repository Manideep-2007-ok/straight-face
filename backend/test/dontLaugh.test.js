import test from 'node:test';
import assert from 'node:assert/strict';
import {
  idleRound, startRound, markCalibrated, beginCountdown, goLive, reportOut, stopRound, playerLeft,
  calibratedCount, publicView,
} from '../logic/dontLaugh.js';

const members = ['a', 'b', 'c'].map((id) => ({ userId: id, name: id.toUpperCase() }));
const live = (ids = ['a', 'b', 'c']) => {
  let s = startRound(members);
  for (const id of ids) s = markCalibrated(s, id);
  return goLive(beginCountdown(s, 1000));
};
const ctx = (playbackPos, now = 5000) => ({ playbackPos, now });

test('needs 2 calibrated players to start the countdown; uncalibrated become spectators', () => {
  let s = markCalibrated(startRound(members), 'a');
  assert.equal(beginCountdown(s, 0).phase, 'calibrating');
  s = markCalibrated(s, 'b');
  const c = beginCountdown(s, 1000);
  assert.equal(c.phase, 'countdown');
  assert.equal(c.countdownEndsAt, 6000);
  assert.deepEqual(Object.keys(c.players).sort(), ['a', 'b']);
  assert.equal(calibratedCount(s), 2);
});

test('last straight face wins', () => {
  let s = live();
  s = reportOut(s, 'a', { t: 10, peak: 0.8 }, ctx(10)).state;
  assert.equal(s.phase, 'live');
  s = reportOut(s, 'b', { t: 20, peak: 0.9 }, ctx(20)).state;
  assert.equal(s.phase, 'ended');
  assert.deepEqual(s.winners, ['c']);
});

test('out is idempotent and keeps the first time', () => {
  let s = live();
  s = reportOut(s, 'a', { t: 10, peak: 0.5 }, ctx(10)).state;
  const again = reportOut(s, 'a', { t: 12, peak: 0.9 }, ctx(12));
  assert.equal(again.accepted, false);
  assert.equal(again.reason, 'ALREADY_OUT');
  assert.equal(s.players.a.outAtT, 10);
});

test('rejects reports outside the round, from non-players, and with bad timestamps', () => {
  assert.equal(reportOut(startRound(members), 'a', { t: 1, peak: 1 }, ctx(1)).reason, 'NOT_LIVE');
  assert.equal(reportOut(live(['a', 'b']), 'c', { t: 1, peak: 1 }, ctx(1)).reason, 'NOT_PLAYING');
  assert.equal(reportOut(live(), 'a', { t: 100, peak: 1 }, ctx(10)).reason, 'BAD_TIME');
});

test('everyone cracks together: the last to crack wins, ties broken by server time', () => {
  let s = live(['a', 'b']);
  s = reportOut(s, 'a', { t: 30.0, peak: 1 }, ctx(30, 5000)).state; // a goes out first -> b wins at once
  assert.deepEqual(s.winners, ['b']);

  // Three players, two crack at the same video second; the later server receipt wins.
  let t = live();
  t = reportOut(t, 'a', { t: 5, peak: 1 }, ctx(5, 5000)).state;
  t = reportOut(t, 'b', { t: 9, peak: 1 }, ctx(9, 6000)).state;
  assert.equal(t.phase, 'ended');
  assert.deepEqual(t.winners, ['c']);
});

test('video ends with 2+ alive: joint Poker faces', () => {
  let s = live();
  s = reportOut(s, 'a', { t: 10, peak: 1 }, ctx(10)).state;
  s = stopRound(s);
  assert.equal(s.phase, 'ended');
  assert.deepEqual(s.winners.sort(), ['b', 'c']);
});

test('a player who disconnects mid-round counts as out and can end the round', () => {
  let s = live(['a', 'b']);
  s = playerLeft(s, 'a', ctx(15));
  assert.equal(s.phase, 'ended');
  assert.deepEqual(s.winners, ['b']);
});

test('leaving during countdown below 2 players resets to idle', () => {
  let s = beginCountdown(markCalibrated(markCalibrated(startRound(members), 'a'), 'b'), 0);
  s = playerLeft(s, 'a', ctx(0));
  assert.equal(s.phase, 'idle');
});

test('publicView exposes only safe fields', () => {
  const v = publicView(live());
  assert.deepEqual(Object.keys(v.players[0]).sort(), ['alive', 'calibrated', 'name', 'outAtT', 'userId']);
  assert.equal(publicView(idleRound()).phase, 'idle');
});
