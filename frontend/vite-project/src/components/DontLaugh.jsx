import { useEffect, useRef, useState } from 'react';
import { useFace } from '../hooks/useFace.js';
import { calibrationThreshold, makeSmileDetector } from '../lib/face.js';

const CALIBRATE_MS = 3000;

// The Don't Laugh card: calibrate -> countdown -> live -> result. Camera frames never leave this browser;
// only a single "I am out" event (time + peak score) is sent when this person smiles.
export default function DontLaugh({ round, me, media, localStream, serverNow, getPosition, emit, hasVideo }) {
  const phase = round?.phase || 'idle';
  const mine = round?.players?.find((p) => p.userId === me.userId);
  const canPlay = media === 'live';
  const inRound = !!mine;
  const [progress, setProgress] = useState(0); // 0..1 calibration ring
  const [tick, setTick] = useState(0);
  const [error, setError] = useState('');
  const calib = useRef({ startedAt: null, samples: [], sent: false });
  const detector = useRef(null);
  const threshold = useRef(0.35);

  const faceActive = canPlay && inRound && (phase === 'calibrating' || phase === 'countdown' || phase === 'live');
  const { status, faceLost } = useFace({
    stream: localStream,
    active: faceActive,
    onFrame: (f) => {
      if (phase === 'calibrating' && mine && !mine.calibrated && f.faceFound) {
        const c = calib.current;
        c.startedAt ??= performance.now();
        c.samples.push(f.smile);
        const p = Math.min(1, (performance.now() - c.startedAt) / CALIBRATE_MS);
        setProgress(p);
        if (p >= 1 && !c.sent) {
          c.sent = true;
          threshold.current = calibrationThreshold(c.samples);
          emit('dl:calibrated', { threshold: threshold.current });
        }
      }
      if (phase === 'live' && mine?.alive && f.faceFound) {
        detector.current ??= makeSmileDetector(threshold.current);
        const r = detector.current.feed(f.smile);
        if (r.out) emit('dl:out', { t: getPosition(), peak: Math.min(1, r.peak) });
      }
    },
  });

  // Reset per-round local state whenever a new round starts.
  useEffect(() => {
    if (phase === 'calibrating') {
      calib.current = { startedAt: null, samples: [], sent: false };
      detector.current = null;
      setProgress(0);
    }
    if (phase === 'countdown') detector.current = null;
  }, [phase]);

  // Countdown clock.
  useEffect(() => {
    if (phase !== 'countdown') return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [phase]);

  if (phase === 'idle') {
    return (
      <div className="dl-bar">
        <button
          className="btn"
          disabled={!hasVideo}
          onClick={async () => {
            setError('');
            const r = await emit('dl:start', {});
            if (r?.error === 'NEED_PLAYERS') setError('Need at least 2 people in the room.');
            else if (r?.error === 'NO_VIDEO') setError('Load a video first.');
            else if (r?.error) setError('Could not start the round.');
          }}
        >
          Start Don't Laugh
        </button>
        {!hasVideo && <span className="muted"> Load a video first.</span>}
        {error && <span className="error-text" role="alert"> {error}</span>}
      </div>
    );
  }

  const names = Object.fromEntries((round.players || []).map((p) => [p.userId, p.name]));
  const calibrated = (round.players || []).filter((p) => p.calibrated).length;

  return (
    <div className="dl-card glass" role="dialog" aria-label="Don't Laugh">
      {phase === 'calibrating' && (
        <div className="stack" style={{ textAlign: 'center' }}>
          <h2>Get a neutral face</h2>
          {!canPlay ? (
            <p className="muted">Your camera is off, so you will watch from the sidelines. The others can still play.</p>
          ) : status === 'error' ? (
            <p className="error-text" role="alert">The face reader could not start. Watch from the sidelines.</p>
          ) : mine?.calibrated ? (
            <p className="muted">Calibrated. Waiting for the others ({calibrated} ready).</p>
          ) : (
            <>
              <div className="ring" style={{ '--p': progress }} aria-hidden="true" />
              <p className="muted">{status === 'loading' ? 'Loading the face reader…' : faceLost ? "We can't see your face. Check your camera." : 'Hold still for 3 seconds. This sets what "calm" looks like for you.'}</p>
            </>
          )}
          <p className="mono muted">{calibrated} calibrated</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn btn-primary" disabled={calibrated < 2} onClick={() => emit('dl:begin')}>Start countdown</button>
            <button className="btn btn-ghost" onClick={() => emit('dl:cancel')}>Cancel</button>
          </div>
        </div>
      )}

      {phase === 'countdown' && (
        <div style={{ textAlign: 'center' }} aria-live="polite">
          <p className="muted">Straight faces. Starting in</p>
          <div className="count mono" key={Math.ceil(Math.max(0, round.countdownEndsAt - serverNow()) / 1000)}>
            {Math.max(1, Math.ceil((round.countdownEndsAt - serverNow()) / 1000))}
          </div>
          <span hidden>{tick}</span>
        </div>
      )}

      {phase === 'live' && (
        <div className="alive-strip" aria-live="polite">
          {round.players.map((p) => (
            <span key={p.userId} className={`alive-chip${p.alive ? '' : ' out'}`}>
              {p.alive ? '♥' : '✕'} {p.name}{!p.alive && ' is out'}
            </span>
          ))}
          {mine?.alive && faceLost && <span className="muted"> We can't see you.</span>}
          {mine?.alive && <button className="btn btn-ghost" onClick={() => emit('dl:stop')}>End round</button>}
        </div>
      )}

      {phase === 'ended' && (
        <div className="stack" style={{ textAlign: 'center' }} aria-live="polite">
          <h2>{round.winners.length > 1 ? 'Poker faces' : 'Straight face wins'}</h2>
          <p style={{ fontSize: '1.25rem' }}>{round.winners.map((id) => names[id]).join(' and ')}</p>
          <ul className="results">
            {[...round.players].sort((a, b) => (b.outAtT ?? Infinity) - (a.outAtT ?? Infinity)).map((p) => (
              <li key={p.userId}>{p.name}: {p.alive ? 'still straight' : `cracked at ${Math.floor(p.outAtT / 60)}:${String(Math.floor(p.outAtT % 60)).padStart(2, '0')}`}</li>
            ))}
          </ul>
          <button className="btn btn-primary" onClick={() => emit('dl:cancel')}>Done</button>
        </div>
      )}
    </div>
  );
}
