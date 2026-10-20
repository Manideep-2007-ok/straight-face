// Reaction Radar maths. Pure functions over stored reaction events.

// events: [{ userId, kind, t, strength, videoId }]. Returns heat[t] in 0..1 for t = 0..length-1:
// for each second, the sum over users of their strongest laugh/smile in that second, divided by how many people were present.
export function bucketHeat(events, participantCount, length) {
  const people = Math.max(1, participantCount);
  const best = new Map(); // `${t}|${userId}` -> max strength
  for (const e of events) {
    if (e.kind !== 'laugh' && e.kind !== 'smile') continue;
    const t = Math.floor(e.t);
    if (t < 0 || t >= length) continue;
    const k = `${t}|${e.userId}`;
    best.set(k, Math.max(best.get(k) ?? 0, e.strength ?? 0));
  }
  const heat = new Array(length).fill(0);
  for (const [k, v] of best) heat[Number(k.split('|')[0])] += v / people;
  return heat.map((x) => Math.min(1, x));
}

export function movingAverage(arr, window = 3) {
  const half = Math.floor(window / 2);
  return arr.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      s += arr[j];
      n++;
    }
    return s / n;
  });
}

// Top local maxima of the smoothed heat, at least `minGap` seconds apart, ignoring near-zero noise.
export function topPeaks(heat, { count = 5, minGap = 10, window = 3, floor = 0.05 } = {}) {
  const sm = movingAverage(heat, window);
  const cands = [];
  for (let i = 0; i < sm.length; i++) {
    const left = i === 0 ? -Infinity : sm[i - 1];
    const right = i === sm.length - 1 ? -Infinity : sm[i + 1];
    if (sm[i] >= floor && sm[i] >= left && sm[i] >= right) cands.push({ t: i, level: sm[i] });
  }
  cands.sort((a, b) => b.level - a.level);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.abs(p.t - c.t) >= minGap)) picked.push(c);
  }
  return picked.sort((a, b) => a.t - b.t);
}
