import { useEffect, useState } from 'react';

// True while the stream's audio is above a threshold for ~150 ms; stays true for 600 ms after it drops.
export function useSpeaking(stream, { threshold = 0.04 } = {}) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length) {
      setSpeaking(false);
      return undefined;
    }
    let ctx;
    let raf;
    let timer;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let loudSince = 0;
      let lastLoud = 0;
      let smooth = 0;
      let on = false;
      timer = setInterval(() => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        smooth = smooth * 0.6 + Math.sqrt(sum / buf.length) * 0.4;
        const now = performance.now();
        if (smooth > threshold) {
          loudSince ||= now;
          lastLoud = now;
          if (!on && now - loudSince > 150) {
            on = true;
            setSpeaking(true);
          }
        } else {
          loudSince = 0;
          if (on && now - lastLoud > 600) {
            on = false;
            setSpeaking(false);
          }
        }
      }, 50);
    } catch {
      /* no Web Audio: no speaker ring */
    }
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
      ctx?.close?.();
    };
  }, [stream, threshold]);

  return speaking;
}
