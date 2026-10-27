import { useEffect, useRef, useState } from 'react';
import { mediapipeEngine } from '../lib/mediapipeEngine.js';
import { customEngine } from '../lib/customEngine.js';

// "custom" is the CNN trained in /model (set VITE_EMOTION_ENGINE=custom). MediaPipe is the default.
const ENGINES = { mediapipe: mediapipeEngine, custom: customEngine };
export const engine = ENGINES[import.meta.env.VITE_EMOTION_ENGINE] || mediapipeEngine;

// Reads the local camera in this browser only. Calls onFrame({smile,surprise,faceFound}) ~8x/s while active.
// status: off | loading | ready | error. faceLost turns true after 2 s without a face.
export function useFace({ stream, active, onFrame, onDiag }) {
  const [status, setStatus] = useState('off');
  const [faceLost, setFaceLost] = useState(false);
  const cb = useRef(onFrame);
  cb.current = onFrame;
  const diag = useRef(onDiag);
  diag.current = onDiag;

  useEffect(() => {
    if (!active || !stream || !stream.getVideoTracks().length) {
      setStatus('off');
      return undefined;
    }
    let stop = null;
    let dead = false;
    let lastSeen = performance.now();
    setStatus('loading');
    const t0 = performance.now();
    const st = { frames: 0, found: 0, smileMax: 0, surpriseMax: 0 };
    diag.current?.('loading', { engine: engine.name, tracks: stream.getVideoTracks().map((t) => t.getSettings?.().width + 'x' + t.getSettings?.().height) });
    const summary = setInterval(() => {
      if (!st.frames) return diag.current?.('no frames yet', { afterSec: Math.round((performance.now() - t0) / 1000) });
      diag.current?.('summary', { frames: st.frames, facePct: Math.round((100 * st.found) / st.frames), smileMax: +st.smileMax.toFixed(2), surpriseMax: +st.surpriseMax.toFixed(2) });
      st.frames = st.found = 0; st.smileMax = st.surpriseMax = 0;
    }, 6000);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream(stream.getVideoTracks());
    video.play().catch(() => {});

    engine
      .start(video, (f) => {
        st.frames++;
        if (f.faceFound) {
          st.found++;
          st.smileMax = Math.max(st.smileMax, f.smile);
          st.surpriseMax = Math.max(st.surpriseMax, f.surprise);
          lastSeen = performance.now();
        }
        setFaceLost(performance.now() - lastSeen > 2000);
        cb.current(f);
      })
      .then((s) => {
        if (dead) return s();
        stop = s;
        setStatus('ready');
        diag.current?.('ready', { loadedInMs: Math.round(performance.now() - t0) });
      })
      .catch((e) => {
        if (dead) return;
        setStatus('error');
        diag.current?.('ERROR', { name: e?.name, message: String(e?.message || e).slice(0, 160) });
      });

    return () => {
      dead = true;
      clearInterval(summary);
      stop?.();
      video.srcObject = null;
    };
  }, [active, stream]);

  return { status, faceLost };
}
