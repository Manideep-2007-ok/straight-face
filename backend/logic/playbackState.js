// Pure playback logic. The server holds the only truth; clients mirror expectedPosition().
export const PLAY_PAUSE_COOLDOWN_MS = 700;

export function initialPlayback(videoId = null, now = Date.now()) {
  return { videoId, status: 'paused', position: 0, updatedAtServer: now, version: 0, by: null, byName: null };
}

export function expectedPosition(state, serverNow) {
  if (state.status !== 'playing') return state.position;
  return state.position + Math.max(0, serverNow - state.updatedAtServer) / 1000;
}

const clampPos = (p) => (Number.isFinite(p) && p >= 0 ? p : 0);

// action: { kind:'set', status, position, videoId? } | { kind:'seek', position }
// ctx: { userId, name, now, lastToggleAt } where lastToggleAt is that user's previous play/pause time.
// Returns { accepted, state, toggledAt?, reason? }. Last write wins; version always increases.
export function applyAction(state, action, ctx) {
  const { userId, name, now, lastToggleAt = 0 } = ctx;

  if (action.kind === 'set') {
    const changesStatus = action.status !== state.status;
    // Same-status "set" (e.g. echo) is ignored; cooldown stops pause wars.
    if (!action.videoId && !changesStatus && Math.abs(clampPos(action.position) - expectedPosition(state, now)) < 1) {
      return { accepted: false, state, reason: 'NOOP' };
    }
    if (changesStatus && now - lastToggleAt < PLAY_PAUSE_COOLDOWN_MS) {
      return { accepted: false, state, reason: 'COOLDOWN' };
    }
    const next = {
      videoId: action.videoId ?? state.videoId,
      status: action.status,
      position: action.videoId && action.videoId !== state.videoId && action.position == null ? 0 : clampPos(action.position),
      updatedAtServer: now,
      version: state.version + 1,
      by: userId,
      byName: name,
    };
    return { accepted: true, state: next, toggledAt: changesStatus ? now : lastToggleAt };
  }

  if (action.kind === 'seek') {
    const next = {
      ...state,
      position: clampPos(action.position),
      updatedAtServer: now,
      version: state.version + 1,
      by: userId,
      byName: name,
    };
    return { accepted: true, state: next };
  }

  return { accepted: false, state, reason: 'UNKNOWN_ACTION' };
}

// Freeze the position when the video ends or is stopped at "now".
export function snapshot(state, now) {
  return { ...state, position: expectedPosition(state, now), updatedAtServer: now };
}
