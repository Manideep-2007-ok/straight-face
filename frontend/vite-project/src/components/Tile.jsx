import { useEffect, useRef, useState } from 'react';
import { useSpeaking } from '../hooks/useSpeaking.js';

// A person's tile: live video when we have it, otherwise their initial.
// The picture is played muted and the sound goes through its own <audio> element: iPhones refuse to autoplay a video
// that has sound, which would leave a black tile even though the call is connected.
export default function Tile({ name, stream, isMe, state, camOff, micOff, out, noRelay, onRetry }) {
  const vref = useRef(null);
  const aref = useRef(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [stuck, setStuck] = useState(false);
  const speaking = useSpeaking(isMe ? null : stream);
  const mySpeaking = useSpeaking(isMe ? stream : null);
  const talking = speaking || mySpeaking;

  useEffect(() => {
    const v = vref.current;
    if (v && v.srcObject !== (stream || null)) {
      v.srcObject = stream || null;
      v.play?.().catch(() => {});
    }
    const a = aref.current;
    if (a && !isMe) {
      if (a.srcObject !== (stream || null)) a.srcObject = stream || null;
      if (stream) {
        a.play().then(() => setSoundBlocked(false)).catch(() => {
          setSoundBlocked(true);
          // the browser wants a tap first: retry on the next one
          window.addEventListener('pointerdown', () => a.play().then(() => setSoundBlocked(false)).catch(() => {}), { once: true });
        });
      }
    }
  }, [stream, isMe]);

  // A call that has been "connecting" for a while is not going to connect on its own.
  useEffect(() => {
    if (isMe || state !== 'connecting') {
      setStuck(false);
      return undefined;
    }
    const t = setTimeout(() => setStuck(true), 12000);
    return () => clearTimeout(t);
  }, [state, isMe]);

  const hasVideo = !!stream?.getVideoTracks().length && !camOff;
  return (
    <li className={`tile${talking ? ' speaking' : ''}${out ? ' is-out' : ''}`} aria-label={`${name}${talking ? ', speaking' : ''}${out ? ', out' : ''}`}>
      <div className="tile-media">
        <video ref={vref} autoPlay playsInline muted style={{ display: hasVideo ? 'block' : 'none' }} />
        {!isMe && <audio ref={aref} autoPlay />}
        {!hasVideo && <span className="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
        {out && <span className="out-stamp">OUT</span>}
      </div>
      <span className="tile-name">
        {isMe ? `${name} (you)` : name}
        {micOff && <span className="muted"> · muted</span>}
        {!isMe && state === 'connecting' && !stuck && <span className="muted"> · connecting…</span>}
        {!isMe && state === 'reconnecting' && <span className="muted"> · reconnecting…</span>}
        {!isMe && state === 'failed' && <span className="muted"> · connection failed</span>}
      </span>
      {!isMe && (stuck || state === 'failed') && (
        <span className="tile-note" role="status">
          Can't connect yet.{' '}
          {noRelay
            ? "If you are on different networks (a phone on mobile data and a laptop on Wi-Fi), a relay server is needed and none is set up. The same Wi-Fi works."
            : "Check that the other person's camera and network are working."}
        </span>
      )}
      {!isMe && (stuck || state === 'failed' || state === 'reconnecting') && onRetry && <button className="chip tap-sound" onClick={onRetry}>Retry video</button>}
      {!isMe && soundBlocked && <button className="chip tap-sound" onClick={() => aref.current?.play().then(() => setSoundBlocked(false)).catch(() => {})}>Tap to hear</button>}
    </li>
  );
}
