// Pure face-signal maths. No camera or MediaPipe in here, so it can be unit-tested.
export const FPS = 8;
export const HOLD_FRAMES = 3; // ~375 ms at 8 fps
export const MIN_THRESHOLD = 0.35;
export const EMA_ALPHA = 0.4;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

// MediaPipe blendshape categories -> expression scores in 0..1.
// `shapes` is an object like { mouthSmileLeft: 0.4, jawOpen: 0.1, ... }.
// The formulas were chosen by measuring MediaPipe on labelled faces (see the README): surprise = open jaw + wide eyes
// scored 0.94 (area under the ROC curve), disgust = nose wrinkle + raised lip + lowered brows 0.85, angry = lowered brows 0.65.
// Sad could not be told apart from neutral (0.5, chance) so it is NOT detected.
export function scoresFromBlendshapes(shapes) {
  const g = (k) => shapes[k] ?? 0;
  const w = (pairs) => pairs.reduce((s, [k, wt]) => s + g(k) * wt, 0) / pairs.reduce((s, [, wt]) => s + wt, 0);
  return {
    smile: clamp01((g('mouthSmileLeft') + g('mouthSmileRight')) / 2),
    surprise: clamp01(w([['jawOpen', 2], ['eyeWideLeft', 1], ['eyeWideRight', 1]]) * 1.5),
    angry: clamp01((g('browDownLeft') + g('browDownRight')) / 2),
    disgust: clamp01(w([['noseSneerLeft', 2], ['noseSneerRight', 2], ['mouthUpperUpLeft', 1], ['mouthUpperUpRight', 1], ['browDownLeft', 1], ['browDownRight', 1]]) * 1.5),
    tongue: clamp01(g('tongueOut')),
    kiss: clamp01(g('mouthPucker')),
    wink: clamp01(Math.abs(g('eyeBlinkLeft') - g('eyeBlinkRight'))),
  };
}

export function makeEma(alpha = EMA_ALPHA) {
  let v = null;
  return (x) => {
    v = v == null ? x : alpha * x + (1 - alpha) * v;
    return v;
  };
}

// Baseline = mean + 2*std of the neutral-face smile samples.
// Per-person threshold = max(0.35, baseline + 0.25).
export function calibrationThreshold(samples) {
  if (!samples.length) return MIN_THRESHOLD;
  const m = mean(samples);
  const std = Math.sqrt(mean(samples.map((x) => (x - m) ** 2)));
  const baseline = m + 2 * std;
  return Math.max(MIN_THRESHOLD, Math.min(0.95, baseline + 0.25));
}

// Fires once when the smoothed smile stays >= threshold for `hold` consecutive frames.
export function makeSmileDetector(threshold, hold = HOLD_FRAMES) {
  let run = 0;
  let fired = false;
  let peak = 0;
  return {
    feed(score) {
      peak = Math.max(peak, score);
      run = score >= threshold ? run + 1 : 0;
      if (!fired && run >= hold) {
        fired = true;
        return { out: true, peak };
      }
      return { out: false, peak };
    },
    get fired() {
      return fired;
    },
  };
}

// ---- Reactions -----------------------------------------------------------------------------------------------------
// Every expression has a lowest possible threshold, a margin above the person's own resting face, and an emoji.
export const REACTIONS = {
  surprise: { emoji: '😮', min: 0.3, margin: 0.15 },
  angry: { emoji: '😠', min: 0.55, margin: 0.25 },
  disgust: { emoji: '🤢', min: 0.35, margin: 0.2 },
  tongue: { emoji: '😛', min: 0.35, margin: 0.1 },
  kiss: { emoji: '😘', min: 0.55, margin: 0.3 },
  wink: { emoji: '😉', min: 0.6, margin: 0.3 },
};
const NAMES = Object.keys(REACTIONS);

// A person's own thresholds from ~3 s of neutral frames (each frame is an object of scores): resting level + margin.
// Without samples, the lowest possible thresholds are used.
export function reactionThresholds(frames = []) {
  const th = {};
  for (const k of NAMES) {
    const xs = frames.map((f) => f[k] ?? 0);
    const m = mean(xs);
    const sd = xs.length ? Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) : 0;
    th[k] = Math.min(0.95, Math.max(REACTIONS[k].min, xs.length ? m + 3 * sd + REACTIONS[k].margin : 0));
  }
  return th;
}

// Which expression, if any, is this frame showing? The one furthest above its own threshold wins.
// A smile blocks disgust and anger (a smile also raises the upper lip and can look like a brow shift).
export function pickReaction(scores, th, smileThreshold) {
  if (scores.smile >= smileThreshold + 0.2) return { kind: 'laugh', emoji: '😂', strength: scores.smile };
  if (scores.smile >= smileThreshold) return { kind: 'smile', emoji: '😄', strength: scores.smile };
  let best = null;
  for (const k of NAMES) {
    if ((k === 'disgust' || k === 'angry') && scores.smile > 0.25) continue;
    const x = scores[k] ?? 0;
    if (x >= th[k]) {
      const ratio = x / th[k];
      if (!best || ratio > best.ratio) best = { kind: k, emoji: REACTIONS[k].emoji, strength: Math.min(1, x), ratio };
    }
  }
  return best && { kind: best.kind, emoji: best.emoji, strength: best.strength };
}

// An expression must hold for a couple of frames before it counts (a blink or a mouth twitch should not).
export function makeHold(frames = 2) {
  let kind = null;
  let run = 0;
  return (r) => {
    const k = r?.kind ?? null;
    run = k && k === kind ? run + 1 : k ? 1 : 0;
    kind = k;
    return k && run >= frames ? r : null;
  };
}

// Per-kind cooldown so reactions do not spam.
export function makeCooldown(ms = 4000) {
  const last = {};
  return (kind, now) => {
    if (last[kind] != null && now - last[kind] < ms) return false;
    last[kind] = now;
    return true;
  };
}
