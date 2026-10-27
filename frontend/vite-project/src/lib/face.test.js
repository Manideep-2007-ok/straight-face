import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoresFromBlendshapes, makeEma, calibrationThreshold, makeSmileDetector, pickReaction, reactionThresholds, makeHold, REACTIONS, makeCooldown, MIN_THRESHOLD,
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

test('scores: every expression is 0..1 and comes from the right blendshapes', () => {
  const s = scoresFromBlendshapes({ jawOpen: 0.7, eyeWideLeft: 0.5, eyeWideRight: 0.5, browDownLeft: 0.8, browDownRight: 0.8, tongueOut: 0.6, mouthPucker: 0.9, eyeBlinkLeft: 0.9, eyeBlinkRight: 0.05 });
  for (const v of Object.values(s)) assert.ok(v >= 0 && v <= 1);
  assert.ok(s.surprise > 0.6 && s.angry === 0.8 && s.tongue === 0.6 && s.kiss === 0.9 && Math.abs(s.wink - 0.85) < 1e-9);
  assert.equal(scoresFromBlendshapes({}).surprise, 0);
});

test('thresholds: personal resting level raises them, an empty calibration falls back to the minimums', () => {
  const none = reactionThresholds([]);
  for (const k of Object.keys(REACTIONS)) assert.equal(none[k], REACTIONS[k].min);
  const brooding = Array.from({ length: 20 }, () => ({ angry: 0.4, surprise: 0.05, kiss: 0.1, disgust: 0, tongue: 0, wink: 0 }));
  const th = reactionThresholds(brooding);
  assert.ok(th.angry >= 0.4 + 0.25 - 1e-9, `naturally low brows need a bigger frown: ${th.angry}`);
  assert.equal(th.surprise, REACTIONS.surprise.min);
  assert.ok(th.angry <= 0.95);
});

test('pickReaction: each gesture gives its own emoji, neutral gives nothing', () => {
  const th = reactionThresholds([]);
  const base = { smile: 0, surprise: 0, angry: 0, disgust: 0, tongue: 0, kiss: 0, wink: 0 };
  assert.equal(pickReaction(base, th, 0.4), null);
  assert.equal(pickReaction({ ...base, smile: 0.95 }, th, 0.4).emoji, '😂');
  assert.equal(pickReaction({ ...base, smile: 0.5 }, th, 0.4).emoji, '😄');
  assert.equal(pickReaction({ ...base, surprise: 0.7 }, th, 0.4).emoji, '😮');
  assert.equal(pickReaction({ ...base, angry: 0.8 }, th, 0.4).emoji, '😠');
  assert.equal(pickReaction({ ...base, disgust: 0.6 }, th, 0.4).emoji, '🤢');
  assert.equal(pickReaction({ ...base, tongue: 0.6 }, th, 0.4).emoji, '😛');
  assert.equal(pickReaction({ ...base, kiss: 0.8 }, th, 0.4).emoji, '😘');
  assert.equal(pickReaction({ ...base, wink: 0.9 }, th, 0.4).emoji, '😉');
});

test('pickReaction: a smile does not count as disgust or anger, and the strongest expression wins', () => {
  const th = reactionThresholds([]);
  const base = { smile: 0, surprise: 0, angry: 0, disgust: 0, tongue: 0, kiss: 0, wink: 0 };
  assert.equal(pickReaction({ ...base, smile: 0.3, disgust: 0.9 }, th, 0.6)?.emoji, undefined); // smile under its threshold, disgust blocked
  assert.equal(pickReaction({ ...base, surprise: 0.4, tongue: 0.9 }, th, 0.4).emoji, '😛'); // tongue is further above its threshold
});

test('hold: an expression must last two frames, and a different one restarts the count', () => {
  const hold = makeHold(2);
  const a = { kind: 'surprise', emoji: '😮' };
  assert.equal(hold(a), null);
  assert.equal(hold(a)?.kind, 'surprise');
  assert.equal(hold({ kind: 'angry', emoji: '😠' }), null);
  assert.equal(hold(null), null);
  assert.equal(hold(a), null);
});

test('cooldown allows one reaction per kind every 4 s', () => {
  const ok = makeCooldown(4000);
  assert.equal(ok('laugh', 0), true);
  assert.equal(ok('laugh', 1000), false);
  assert.equal(ok('surprise', 1000), true);
  assert.equal(ok('laugh', 4001), true);
});
