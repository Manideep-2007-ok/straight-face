// Mirror of backend/logic/playbackState.js expectedPosition, plus client-only clock and drift maths.
export function expectedPosition(state, serverNow) {
  if (state.status !== 'playing') return state.position;
  return state.position + Math.max(0, serverNow - state.updatedAtServer) / 1000;
}

// samples: [{ c0, s, c1 }] = client send time, server time in reply, client receive time (ms).
// Keep the sample with the lowest round trip; offset = serverTime - clientTime.
export function computeOffset(samples) {
  if (!samples.length) return 0;
  let best = null;
  for (const x of samples) {
    const rtt = x.c1 - x.c0;
    if (!best || rtt < best.rtt) best = { rtt, offset: x.s - (x.c0 + rtt / 2) };
  }
  return best.offset;
}

// drift = player position minus expected position, in seconds.
export function driftAction(drift) {
  const d = Math.abs(drift);
  if (d > 1.2) return { type: 'seek' };
  if (d >= 0.3) return { type: 'rate', rate: drift > 0 ? 0.95 : 1.05 };
  return { type: 'none' };
}

// Chat that respects video time (see plan 6.5): hide messages from later than I have watched.
export function visibleMessages(messages, myPosition, videoId) {
  const shown = [];
  let hidden = 0;
  for (const m of messages) {
    if (m.videoId !== videoId || m.t == null || m.t <= myPosition + 2) shown.push(m);
    else hidden++;
  }
  return { shown, hidden };
}
