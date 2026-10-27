import { useEffect, useRef, useState } from 'react';
import { useFace } from '../hooks/useFace.js';
import { autoReaction, makeCooldown } from '../lib/face.js';

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
// `paused` is true during a Don't Laugh round, which does its own reading.
export function FaceReactions({ enabled, paused, stream, emit, getPosition, onLevel }) {
  const cooldown = useRef(makeCooldown(4000));
  const second = useRef({ at: 0, smile: 0, surprise: 0 });
  const { status } = useFace({
    stream,
    active: enabled && !paused,
    onDiag: (event, info) => emit('face:diag', { event: `reactions ${event}`, info }),
    onFrame: (f) => {
      if (!f.faceFound) return;
      const now = performance.now();
      const s = second.current;
      s.smile = Math.max(s.smile, f.smile);
      s.surprise = Math.max(s.surprise, f.surprise);
      if (now - s.at >= 1000) {
        emit('radar:sample', { t: getPosition(), smile: s.smile, surprise: s.surprise });
        onLevel?.(s.smile);
        second.current = { at: now, smile: 0, surprise: 0 };
      }
      const r = autoReaction(f, 0.45);
      if (r && cooldown.current(r.kind, now)) emit('react:emoji', { emoji: r.emoji, auto: true, strength: Math.min(1, r.strength) });
    },
  });
  return enabled && status === 'loading' ? <span className="muted">Loading the face reader…</span> : status === 'error' ? <span className="error-text">Face reader could not start.</span> : null;
}
