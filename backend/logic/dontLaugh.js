// Don't Laugh round rules as pure functions. State is plain data; every function returns a new state.
// Phases: idle -> calibrating -> countdown -> live -> ended
export const MIN_PLAYERS = 2;
export const COUNTDOWN_MS = 5000;
export const MAX_T_SKEW = 5; // seconds a reported "out" time may differ from the server's playback time

export const idleRound = () => ({ phase: 'idle', players: {}, winners: [], countdownEndsAt: null });

export function startRound(members, config = {}) {
  const players = {};
  for (const m of members) {
    players[m.userId] = { userId: m.userId, name: m.name, calibrated: false, alive: true, outAtT: null, outAtServer: null, peak: 0 };
  }
  return { phase: 'calibrating', players, winners: [], countdownEndsAt: null, config };
}

export function markCalibrated(state, userId) {
  if (state.phase !== 'calibrating' || !state.players[userId]) return state;
  return { ...state, players: { ...state.players, [userId]: { ...state.players[userId], calibrated: true } } };
}

export const calibratedCount = (state) => Object.values(state.players).filter((p) => p.calibrated).length;

// Move to countdown. Only calibrated players take part; others become spectators (removed).
export function beginCountdown(state, now) {
  if (state.phase !== 'calibrating' || calibratedCount(state) < MIN_PLAYERS) return state;
  const players = {};
  for (const [id, p] of Object.entries(state.players)) if (p.calibrated) players[id] = p;
  return { ...state, phase: 'countdown', players, countdownEndsAt: now + COUNTDOWN_MS };
}

export function goLive(state) {
  return state.phase === 'countdown' ? { ...state, phase: 'live', countdownEndsAt: null } : state;
}

export const alivePlayers = (state) => Object.values(state.players).filter((p) => p.alive);

function finishIfDone(state) {
  const alive = alivePlayers(state);
  if (alive.length > 1) return state;
  if (alive.length === 1) return { ...state, phase: 'ended', winners: [alive[0].userId] };
  // Everyone out: the last to crack wins. Compare video time, then server receive time.
  const all = Object.values(state.players);
  const last = all.reduce((a, b) => (b.outAtT > a.outAtT || (b.outAtT === a.outAtT && b.outAtServer > a.outAtServer) ? b : a));
  return { ...state, phase: 'ended', winners: [last.userId] };
}

// ctx: { now, playbackPos }. Idempotent: a player already out stays out with their first time.
export function reportOut(state, userId, { t, peak }, ctx) {
  if (state.phase !== 'live') return { state, accepted: false, reason: 'NOT_LIVE' };
  const p = state.players[userId];
  if (!p) return { state, accepted: false, reason: 'NOT_PLAYING' };
  if (!p.alive) return { state, accepted: false, reason: 'ALREADY_OUT' };
  if (Math.abs(t - ctx.playbackPos) > MAX_T_SKEW) return { state, accepted: false, reason: 'BAD_TIME' };
  const next = {
    ...state,
    players: { ...state.players, [userId]: { ...p, alive: false, outAtT: t, outAtServer: ctx.now, peak: Math.max(0, Math.min(1, peak)) } },
  };
  return { state: finishIfDone(next), accepted: true };
}

// The video ended or someone stopped the round. 2+ alive means joint "Poker faces".
export function stopRound(state) {
  if (state.phase !== 'live') return state;
  const alive = alivePlayers(state);
  if (alive.length >= 2) return { ...state, phase: 'ended', winners: alive.map((p) => p.userId) };
  return finishIfDone(state);
}

// A player disconnecting mid-round counts as out (at their last known time) so the round can still end.
export function playerLeft(state, userId, ctx) {
  const p = state.players[userId];
  if (!p || !p.alive || (state.phase !== 'live' && state.phase !== 'countdown')) return state;
  if (state.phase === 'countdown') {
    const players = { ...state.players };
    delete players[userId];
    return Object.keys(players).length < MIN_PLAYERS ? idleRound() : { ...state, players };
  }
  return reportOut(state, userId, { t: ctx.playbackPos, peak: 0 }, ctx).state;
}

// Safe shape for clients.
export function publicView(state) {
  return {
    phase: state.phase,
    countdownEndsAt: state.countdownEndsAt,
    winners: state.winners,
    players: Object.values(state.players).map((p) => ({ userId: p.userId, name: p.name, calibrated: p.calibrated, alive: p.alive, outAtT: p.outAtT })),
  };
}
