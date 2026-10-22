// Pure face-signal maths. No camera or MediaPipe in here, so it can be unit-tested.
export const FPS = 8;
export const HOLD_FRAMES = 3; // ~375 ms at 8 fps
export const MIN_THRESHOLD = 0.35;
export const EMA_ALPHA = 0.4;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

// MediaPipe blendshape categories -> { smile, surprise } in 0..1.
// `shapes` is an object like { mouthSmileLeft: 0.4, jawOpen: 0.1, ... }.
export function scoresFromBlendshapes(shapes) {
  const g = (k) => shapes[k] ?? 0;
  const smile = clamp01((g('mouthSmileLeft') + g('mouthSmileRight')) / 2);
  const surprise = clamp01(mean([g('jawOpen'), g('eyeWideLeft'), g('eyeWideRight'), g('browInnerUp')]) * 1.6);
  return { smile, surprise };
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

// Auto reactions (plan 6.4): which emoji, if any, a frame should trigger.
export function autoReaction({ smile, surprise }, threshold) {
  if (smile >= threshold + 0.2) return { kind: 'laugh', emoji: '😂', strength: smile };
  if (smile >= threshold) return { kind: 'smile', emoji: '😄', strength: smile };
  if (surprise >= 0.6) return { kind: 'surprise', emoji: '😮', strength: surprise };
  return null;
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
