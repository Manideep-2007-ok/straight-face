import { useEffect, useRef, useState } from 'react';
import { useFace } from '../hooks/useFace.js';
import { pickReaction, reactionThresholds, calibrationThreshold, makeHold, makeCooldown } from '../lib/face.js';

export const EMOJIS = ['😂', '😄', '😮', '❤️', '👏', '🔥', '😱', '💀'];

// Floating emoji over the stage. Each one rises with a slight sway; with reduced motion it just fades.
export function FloatingEmoji({ items }) {
  return (
    <div className="floaters" aria-hidden="true">
      {items.map((r) => (
        <span key={r.id} className="floater" style={{ left: `${r.x}%`, '--sway': `${r.sway}px` }}>
          {r.emoji}
          <small>{r.name}</small>
        </span>
      ))}
    </div>
  );
}

export function useFloaters(socketRef) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return undefined;
    const onReact = (r) => {
      const x = 8 + Math.random() * 80;
      const sway = (Math.random() - 0.5) * 40;
      setItems((cur) => [...cur.slice(-14), { ...r, x, sway }]);
      setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== r.id)), 2600);
    };
    socket.on('react:new', onReact);
    return () => socket.off('react:new', onReact);
  }, [socketRef]);
  return items;
}

// Opt-in face reactions: reads the camera in this browser, sends emoji + one number per second.
// First it learns your resting face for 3 seconds, so naturally low brows or a naturally open mouth are not mistaken for
// an expression. `paused` is true during a Don't Laugh round, which does its own reading.
export function FaceReactions({ enabled, paused, stream, emit, getPosition, onLevel }) {
  const cooldown = useRef(makeCooldown(4000));
  const hold = useRef(makeHold(2));
  const second = useRef({ at: 0, smile: 0, surprise: 0 });
  const calib = useRef({ startedAt: null, frames: [], th: null, smileTh: 0.4 });
  const [phase, setPhase] = useState('calibrating'); // calibrating | live
  const [seeing, setSeeing] = useState('');
  const lastShown = useRef(0);

  // each time reactions are switched on we learn the resting face again
  useEffect(() => {
    calib.current = { startedAt: null, frames: [], th: null, smileTh: 0.4 };
    hold.current = makeHold(2);
    setPhase('calibrating');
    setSeeing('');
  }, [enabled]);

  const { status } = useFace({
    stream,
    active: enabled && !paused,
    onDiag: (event, info) => emit('face:diag', { event: `reactions ${event}`, info }),
    onFrame: (f) => {
      if (!f.faceFound) return;
      const now = performance.now();
      const c = calib.current;
      if (!c.th) {
        c.startedAt ??= now;
        c.frames.push(f);
        if (now - c.startedAt >= 3000) {
          c.th = reactionThresholds(c.frames);
          c.smileTh = calibrationThreshold(c.frames.map((x) => x.smile));
          emit('face:diag', { event: 'reactions thresholds', info: Object.fromEntries(Object.entries(c.th).map(([k, v]) => [k, +v.toFixed(2)])) });
          setPhase('live');
        }
        return;
      }
      const s = second.current;
      s.smile = Math.max(s.smile, f.smile);
      s.surprise = Math.max(s.surprise, f.surprise);
      if (now - s.at >= 1000) {
        emit('radar:sample', { t: getPosition(), smile: s.smile, surprise: s.surprise });
        onLevel?.(s.smile);
        second.current = { at: now, smile: 0, surprise: 0 };
      }
      const r = pickReaction(f, c.th, c.smileTh);
      if (now - lastShown.current > 250) {
        lastShown.current = now;
        setSeeing(r ? `${r.emoji} ${r.kind}` : 'neutral');
      }
      const held = hold.current(r);
      if (held && cooldown.current(held.kind, now)) emit('react:emoji', { emoji: held.emoji, auto: true, strength: Math.min(1, held.strength) });
    },
  });

  if (!enabled) return null;
  if (status === 'error') return <span className="error-text">Face reader could not start.</span>;
  if (status === 'loading') return <span className="muted">Loading the face reader…</span>;
  if (phase === 'calibrating') return <span className="muted" role="status">Hold a neutral face for 3 seconds…</span>;
  return (
    <span className="muted" role="status" aria-live="off">
      Seeing: <strong style={{ color: 'var(--text)' }}>{seeing || 'neutral'}</strong>. Try a smile, surprise, a frown, a wrinkled nose, tongue out, a kiss or a wink.
    </span>
  );
}
