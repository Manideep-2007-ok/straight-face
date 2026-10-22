import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoresFromBlendshapes, makeEma, calibrationThreshold, makeSmileDetector, autoReaction, makeCooldown, MIN_THRESHOLD,
} from './face.js';

test('scoresFromBlendshapes: smile is the mean of both mouth corners, all clamped to 0..1', () => {
  const r = scoresFromBlendshapes({ mouthSmileLeft: 0.8, mouthSmileRight: 0.4 });
  assert.ok(Math.abs(r.smile - 0.6) < 1e-9);
  assert.equal(scoresFromBlendshapes({}).smile, 0);
  const wide = scoresFromBlendshapes({ jawOpen: 1, eyeWideLeft: 1, eyeWideRight: 1, browInnerUp: 1 });
  assert.equal(wide.surprise, 1);
});

test('ema smooths toward new values', () => {
  const ema = makeEma(0.4);
  assert.equal(ema(1), 1);
  assert.ok(Math.abs(ema(0) - 0.6) < 1e-9);
});

test('calibration: quiet face gets the minimum threshold, naturally smiley face gets a higher one', () => {
  assert.equal(calibrationThreshold([0.02, 0.03, 0.02, 0.03]), MIN_THRESHOLD);
  const smiley = calibrationThreshold([0.3, 0.32, 0.31, 0.3]);
  assert.ok(smiley > 0.55 && smiley < 0.7, `got ${smiley}`);
  assert.equal(calibrationThreshold([]), MIN_THRESHOLD);
  assert.ok(calibrationThreshold([1, 1, 1]) <= 0.95);
});

test('smile detector needs 3 consecutive frames and fires only once', () => {
  const d = makeSmileDetector(0.4);
  assert.equal(d.feed(0.5).out, false);
  assert.equal(d.feed(0.5).out, false);
  assert.equal(d.feed(0.2).out, false); // streak broken
  assert.equal(d.feed(0.5).out, false);
  assert.equal(d.feed(0.6).out, false);
  const hit = d.feed(0.7);
  assert.equal(hit.out, true);
  assert.equal(hit.peak, 0.7);
  assert.equal(d.feed(0.9).out, false);
  assert.equal(d.fired, true);
});

test('auto reactions pick laugh > smile > surprise and respect the threshold', () => {
  assert.equal(autoReaction({ smile: 0.9, surprise: 0.9 }, 0.4).emoji, '😂');
  assert.equal(autoReaction({ smile: 0.45, surprise: 0 }, 0.4).emoji, '😄');
  assert.equal(autoReaction({ smile: 0.1, surprise: 0.7 }, 0.4).emoji, '😮');
  assert.equal(autoReaction({ smile: 0.1, surprise: 0.2 }, 0.4), null);
});

test('cooldown allows one reaction per kind every 4 s', () => {
  const ok = makeCooldown(4000);
  assert.equal(ok('laugh', 0), true);
  assert.equal(ok('laugh', 1000), false);
  assert.equal(ok('surprise', 1000), true);
  assert.equal(ok('laugh', 4001), true);
});
