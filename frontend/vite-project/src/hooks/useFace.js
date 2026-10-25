import { useEffect, useRef, useState } from 'react';
import { mediapipeEngine } from '../lib/mediapipeEngine.js';
import { customEngine } from '../lib/customEngine.js';

// "custom" is the CNN trained in /model (set VITE_EMOTION_ENGINE=custom). MediaPipe is the default.
const ENGINES = { mediapipe: mediapipeEngine, custom: customEngine };
export const engine = ENGINES[import.meta.env.VITE_EMOTION_ENGINE] || mediapipeEngine;

// Reads the local camera in this browser only. Calls onFrame({smile,surprise,faceFound}) ~8x/s while active.
// status: off | loading | ready | error. faceLost turns true after 2 s without a face.
export function useFace({ stream, active, onFrame }) {
  const [status, setStatus] = useState('off');
  const [faceLost, setFaceLost] = useState(false);
  const cb = useRef(onFrame);
  cb.current = onFrame;

  useEffect(() => {
    if (!active || !stream || !stream.getVideoTracks().length) {
      setStatus('off');
      return undefined;
    }
    let stop = null;
    let dead = false;
    let lastSeen = performance.now();
    setStatus('loading');
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream(stream.getVideoTracks());
    video.play().catch(() => {});

    engine
      .start(video, (f) => {
        if (f.faceFound) lastSeen = performance.now();
        setFaceLost(performance.now() - lastSeen > 2000);
        cb.current(f);
      })
      .then((s) => {
        if (dead) return s();
        stop = s;
        setStatus('ready');
      })
      .catch(() => !dead && setStatus('error'));

    return () => {
      dead = true;
      stop?.();
      video.srcObject = null;
    };
  }, [active, stream]);

  return { status, faceLost };
}
