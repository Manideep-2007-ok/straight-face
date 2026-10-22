import { useEffect, useRef } from 'react';
import { useSpeaking } from '../hooks/useSpeaking.js';

// A person's tile: live video when we have it, otherwise their initial.
export default function Tile({ name, stream, isMe, state, camOff, micOff, out, onSpeaking }) {
  const ref = useRef(null);
  const speaking = useSpeaking(isMe ? null : stream);
  const mySpeaking = useSpeaking(isMe ? stream : null);
  const talking = speaking || mySpeaking;

  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null;
  }, [stream]);
  useEffect(() => {
    onSpeaking?.(talking);
  }, [talking, onSpeaking]);

  const hasVideo = !!stream?.getVideoTracks().length && !camOff;
  return (
    <li className={`tile${talking ? ' speaking' : ''}${out ? ' is-out' : ''}`} aria-label={`${name}${talking ? ', speaking' : ''}${out ? ', out' : ''}`}>
      <div className="tile-media">
        <video ref={ref} autoPlay playsInline muted={isMe} style={{ display: hasVideo ? 'block' : 'none' }} />
        {!hasVideo && <span className="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
        {out && <span className="out-stamp">OUT</span>}
      </div>
      <span className="tile-name">
        {isMe ? `${name} (you)` : name}
        {micOff && <span className="muted"> · muted</span>}
        {!isMe && state === 'connecting' && <span className="muted"> · connecting…</span>}
        {!isMe && state === 'reconnecting' && <span className="muted"> · reconnecting…</span>}
      </span>
    </li>
  );
}
