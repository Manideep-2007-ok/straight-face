import { useEffect, useRef, useState } from 'react';
import { Music, MonitorUp, Square } from 'lucide-react';

// Re-render when tracks arrive on a stream (a remote stream gets its audio and video tracks one at a time).
function useTracks(stream) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!stream) return undefined;
    const f = () => bump((n) => n + 1);
    stream.addEventListener('addtrack', f);
    stream.addEventListener('removetrack', f);
    return () => {
      stream.removeEventListener('addtrack', f);
      stream.removeEventListener('removetrack', f);
    };
  }, [stream]);
}

function AudioCard({ icon: Icon = Music, title, note }) {
  return (
    <div className="audio-card">
      <Icon size={44} aria-hidden="true" />
      <p className="audio-title">{title}</p>
      <p className="muted">{note}</p>
      {Icon === Music && (
        <div className="bars" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.11}s` }} />)}
        </div>
      )}
    </div>
  );
}

// The sharer's own player for a local file (video, or audio such as MP3). It plays here, and its picture and sound
// are captured and sent to everyone. Pausing or seeking here pauses or seeks it for the whole room.
export function FilePlayer({ file, onStream, onFail, onEnded }) {
  const ref = useRef(null);
  const isAudio = file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(file.name);
  const [url, setUrl] = useState(null);
  const cb = useRef({});
  cb.current = { onStream, onFail, onEnded };

  // The temporary address for the file is made inside the effect, so React's development double-mount cannot revoke it early.
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !url) return undefined;
    let cancelled = false;
    const go = async () => {
      try {
        await el.play();
      } catch {
        if (!cancelled) cb.current.onFail('Your browser blocked playback. Press play on the player, then pick the file again.');
        return;
      }
      const stream = el.captureStream ? el.captureStream() : el.mozCaptureStream?.();
      if (cancelled) return;
      if (!stream || !stream.getTracks().length) {
        cb.current.onFail('This browser cannot share a file. Try Chrome or Edge on a computer.');
        return;
      }
      cb.current.onStream(stream);
    };
    const onEnd = () => cb.current.onEnded?.();
    const onErr = () => !cancelled && cb.current.onFail('That file could not be played. Try an MP3, M4A, WAV, MP4 or WebM file.');
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onErr);
    el.addEventListener('canplay', go, { once: true });
    return () => {
      cancelled = true;
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('error', onErr);
      el.removeEventListener('canplay', go);
    };
  }, [url]);

  return isAudio ? (
    <div className="file-audio">
      <AudioCard title={file.name} note="Playing from your computer. Everyone hears it." />
      <audio ref={ref} src={url || undefined} controls />
    </div>
  ) : (
    <video ref={ref} src={url || undefined} controls playsInline className="share-video" />
  );
}

export default function ShareStage({ share, me, remoteStream, file, onFileStream, onFileFail, onStop }) {
  useTracks(remoteStream);
  const viewerRef = useRef(null);
  const iAmSharer = (share && share.userId === me.userId) || (!share && !!file);
  const hasVideo = !!remoteStream?.getVideoTracks().length;

  useEffect(() => {
    const v = viewerRef.current;
    if (v && v.srcObject !== (remoteStream || null)) v.srcObject = remoteStream || null;
  }, [remoteStream, share, hasVideo]);

  if (!share && !file) return null;
  const what = share?.label || (share?.kind === 'file' ? 'a file' : 'a tab or screen');

  return (
    <div className="share-stage">
      <div className="share-bar glass">
        <MonitorUp size={16} aria-hidden="true" />
        <span>{iAmSharer ? `You are sharing ${what}` : `${share?.name} is sharing ${what}`}</span>
        {iAmSharer && (
          <button className="btn btn-ghost stop-btn" onClick={onStop}>
            <Square size={14} aria-hidden="true" /> Stop sharing
          </button>
        )}
      </div>

      {iAmSharer && file && <FilePlayer file={file} onStream={onFileStream} onFail={onFileFail} onEnded={onStop} />}

      {iAmSharer && !file && (
        <AudioCard
          icon={MonitorUp}
          title="Your screen is being shared"
          note="Everyone in the room can see it. If you shared this tab you would see a mirror of it, so switch to the tab you shared."
        />
      )}

      {!iAmSharer && !remoteStream && <div className="audio-card"><p className="muted" role="status">Connecting to {share?.name}…</p></div>}
      {!iAmSharer && remoteStream && !hasVideo && <AudioCard title={share?.label || 'Shared audio'} note={`${share?.name} is playing this for the room.`} />}
      {/* One element for both cases: it plays audio-only streams (MP3) as well as video. Controls give volume and fullscreen. */}
      {!iAmSharer && remoteStream && (
        <video ref={viewerRef} autoPlay playsInline controls className={hasVideo ? 'share-video' : 'share-video audio-only'} />
      )}
    </div>
  );
}
