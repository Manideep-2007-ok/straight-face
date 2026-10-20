import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketHeat, movingAverage, topPeaks } from '../logic/heat.js';
import { computeAwards } from '../logic/awards.js';

test('bucketHeat: per-second max per user, averaged over people present', () => {
  const events = [
    { userId: 'a', kind: 'laugh', t: 5.2, strength: 0.4 },
    { userId: 'a', kind: 'laugh', t: 5.8, strength: 0.8 }, // same second, keeps 0.8
    { userId: 'b', kind: 'smile', t: 5.1, strength: 0.4 },
    { userId: 'a', kind: 'surprise', t: 6, strength: 1 }, // surprise does not heat the laugh map
    { userId: 'a', kind: 'laugh', t: 999, strength: 1 }, // outside length
  ];
  const heat = bucketHeat(events, 2, 10);
  assert.equal(heat.length, 10);
  assert.ok(Math.abs(heat[5] - 0.6) < 1e-9);
  assert.equal(heat[6], 0);
});

test('bucketHeat with no participants does not divide by zero', () => {
  assert.equal(bucketHeat([{ userId: 'a', kind: 'laugh', t: 0, strength: 0.5 }], 0, 3)[0], 0.5);
});

test('movingAverage smooths with edge handling', () => {
  assert.deepEqual(movingAverage([0, 3, 0], 3), [1.5, 1, 1.5]);
});

test('topPeaks returns local maxima at least 10 s apart, strongest first picked', () => {
  const heat = new Array(60).fill(0);
  heat[10] = 0.9; heat[11] = 0.8; // one peak near 10
  heat[14] = 0.95; // within 10s of the first: dropped if weaker after smoothing
  heat[40] = 0.7;
  const peaks = topPeaks(heat, { count: 5, minGap: 10 });
  assert.ok(peaks.length >= 2);
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i].t - peaks[i - 1].t >= 10);
  assert.ok(peaks.some((p) => Math.abs(p.t - 40) <= 1));
});

test('topPeaks ignores a flat/quiet room', () => {
  assert.deepEqual(topPeaks(new Array(30).fill(0)), []);
});

test('awards: first to crack, champion, biggest laugh, most shocked, hype person', () => {
  const rounds = [
    { outcomes: [{ userId: 'a', outAtT: 12, peak: 0.9 }, { userId: 'b', outAtT: 30, peak: 0.8 }, { userId: 'c', outAtT: null }], winners: ['c'] },
    { outcomes: [{ userId: 'a', outAtT: 50, peak: 0.7 }, { userId: 'c', outAtT: 60, peak: 0.7 }], winners: ['c'] },
  ];
  const events = [
    { userId: 'a', kind: 'laugh', strength: 0.95 },
    { userId: 'b', kind: 'laugh', strength: 0.5 },
    { userId: 'b', kind: 'surprise', strength: 0.7 },
    { userId: 'b', kind: 'surprise', strength: 0.8 },
    { userId: 'c', kind: 'emoji', source: 'manual' },
    { userId: 'c', kind: 'emoji', source: 'auto' },
  ];
  const awards = computeAwards({ rounds, events, names: { a: 'Asha', b: 'Bo', c: 'Cy' } });
  const by = Object.fromEntries(awards.map((x) => [x.key, x]));
  assert.equal(by['first-to-crack'].name, 'Asha');
  assert.equal(by['poker-face'].name, 'Cy');
  assert.equal(by['poker-face'].detail, '2 rounds won');
  assert.equal(by['biggest-laugh'].name, 'Asha');
  assert.equal(by['most-shocked'].name, 'Bo');
  assert.equal(by['hype-person'].name, 'Cy');
  assert.equal(by['hype-person'].detail, '1 emoji');
});

test('awards: empty party gives no awards', () => {
  assert.deepEqual(computeAwards({}), []);
});
