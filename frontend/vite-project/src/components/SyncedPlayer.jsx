import { useEffect, useRef, useState } from 'react';
import { loadYouTubeApi } from '../lib/youtube.js';
import { expectedPosition, driftAction } from '../lib/sync.js';

const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_ENDED = 0;
const YT_ERRORS = { 2: 'That video id is not valid.', 5: 'The player hit an error.', 100: 'That video was removed or is private.', 101: 'The owner does not allow embedding.', 150: 'The owner does not allow embedding.' };

// Mirrors the room's playback state into a YouTube player, and reports local play/pause/seek.
// Local controls are YouTube's own; anyone in the room can use them.
export default function SyncedPlayer({ playback, serverNow, started, onSet, onSeek, onPosition, onEnded }) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const applyingRemote = useRef(false);
  const applyTimer = useRef(null);
  const latest = useRef({ playback, serverNow, started });
  const lastPos = useRef({ t: 0, at: 0 });
  latest.current = { playback, serverNow, started };

  const cb = useRef({});
  cb.current = { onSet, onSeek, onPosition };

  function guard() {
    applyingRemote.current = true;
    clearTimeout(applyTimer.current);
    applyTimer.current = setTimeout(() => (applyingRemote.current = false), 500);
  }

  // Create the player once.
  useEffect(() => {
    let dead = false;
    loadYouTubeApi()
      .then((YT) => {
        if (dead) return;
        playerRef.current = new YT.Player(hostRef.current, {
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
          events: {
            onReady: () => setReady(true),
            onError: (e) => setError(YT_ERRORS[e.data] || 'The video could not play.'),
            onStateChange: (e) => {
              if (e.data === YT_ENDED) cb.current.onEnded?.();
              if (applyingRemote.current) return;
              const { playback: pb } = latest.current;
              const p = playerRef.current;
              if (!pb || !p) return;
              if (e.data === YT_PLAYING && pb.status !== 'playing') cb.current.onSet('playing', p.getCurrentTime());
              if (e.data === YT_PAUSED && pb.status !== 'paused') cb.current.onSet('paused', p.getCurrentTime());
            },
          },
        });
      })
      .catch((e) => setError(e.message));
    return () => {
      dead = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, []);

  // Apply remote state whenever it changes (or the user has just clicked "Join the party").
  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p || !playback?.videoId || !started) return;
    setError('');
    guard();
    const target = expectedPosition(playback, serverNow());
    const cur = p.getVideoData?.().video_id;
    if (cur !== playback.videoId) {
      if (playback.status === 'playing') p.loadVideoById(playback.videoId, target);
      else p.cueVideoById(playback.videoId, target);
      lastPos.current = { t: target, at: Date.now() };
      return;
    }
    if (Math.abs(p.getCurrentTime() - target) > 0.5) p.seekTo(target, true);
    if (playback.status === 'playing') p.playVideo();
    else p.pauseVideo();
    lastPos.current = { t: target, at: Date.now() };
  }, [playback, ready, started, serverNow]);

  // Every 500 ms: detect a local seek, report position. Every 2 s: drift correction.
  useEffect(() => {
    if (!ready) return undefined;
    let tick = 0;
    const id = setInterval(() => {
      const p = playerRef.current;
      const { playback: pb, serverNow: sn, started: st } = latest.current;
      if (!p || !pb?.videoId || !st || applyingRemote.current) return;
      const t = p.getCurrentTime();
      cb.current.onPosition?.(t);
      const dt = (Date.now() - lastPos.current.at) / 1000;
      const advanced = pb.status === 'playing' ? dt * (p.getPlaybackRate?.() || 1) : 0;
      const jumped = Math.abs(t - (lastPos.current.t + advanced)) > 1.5;
      lastPos.current = { t, at: Date.now() };
      if (jumped) return cb.current.onSeek(t);
      tick++;
      if (tick % 4 === 0 && pb.status === 'playing') {
        const drift = t - expectedPosition(pb, sn());
        const a = driftAction(drift);
        if (a.type === 'seek') {
          guard();
          p.seekTo(expectedPosition(pb, sn()), true);
        } else if (a.type === 'rate') {
          p.setPlaybackRate?.(a.rate);
          setTimeout(() => playerRef.current?.setPlaybackRate?.(1), 2000);
        }
      }
    }, 500);
    return () => clearInterval(id);
  }, [ready]);

  return (
    <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#000', borderRadius: 'var(--radius-stage)', overflow: 'hidden', boxShadow: '0 0 calc(40px + 120px * var(--room-glow)) calc(10px * var(--room-glow)) color-mix(in srgb, var(--glow) calc(55% * var(--room-glow)), transparent)' }}>
      <div style={{ position: 'absolute', inset: 0, visibility: playback?.videoId ? 'visible' : 'hidden' }}>
        <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      </div>
      {!playback?.videoId && !error && (
        <div className="muted" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 'var(--s6)', textAlign: 'center', pointerEvents: 'none' }}>
          Paste a YouTube link below to start.
        </div>
      )}
      {error && (
        <div role="alert" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--surface)', padding: 'var(--s6)', textAlign: 'center' }}>
          <div>
            <p>{error}</p>
            <p className="muted" style={{ marginTop: 'var(--s2)' }}>Pick another video below.</p>
          </div>
        </div>
      )}
    </div>
  );
}
