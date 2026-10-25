import { getLandmarker } from './mediapipeEngine.js';
import { loadEmotionNet } from './emotionNet.js';
import { makeEma, FPS } from './face.js';

// EmotionEngine "custom": MediaPipe finds the face box, then the CNN trained in /model reads a 48x48 grayscale crop.
// smile = P(happy), surprise = P(surprise). start(video, onFrame) -> stop().
const MARGIN = 0.2;

export const customEngine = {
  name: 'custom',
  preload: () => Promise.all([getLandmarker(), loadEmotionNet()]),
  async start(video, onFrame) {
    const [landmarker, net] = await Promise.all([getLandmarker(), loadEmotionNet()]);
    const iHappy = net.classes.indexOf('happy');
    const iSurprise = net.classes.indexOf('surprise');
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const smileEma = makeEma();
    const surpriseEma = makeEma();
    const pixels = new Float32Array(48 * 48);
    let lastVideoTime = -1;
    let busy = false;

    const timer = setInterval(() => {
      if (busy || video.readyState < 2 || video.videoWidth === 0 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      busy = true;
      try {
        const lm = landmarker.detectForVideo(video, performance.now()).faceLandmarks?.[0];
        if (!lm) return onFrame({ smile: 0, surprise: 0, faceFound: false });
        let minX = 1; let minY = 1; let maxX = 0; let maxY = 0;
        for (const p of lm) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        const W = video.videoWidth;
        const H = video.videoHeight;
        const mx = (maxX - minX) * MARGIN;
        const my = (maxY - minY) * MARGIN;
        const sx = Math.max(0, (minX - mx) * W);
        const sy = Math.max(0, (minY - my) * H);
        const sw = Math.min(W - sx, (maxX - minX + 2 * mx) * W);
        const sh = Math.min(H - sy, (maxY - minY + 2 * my) * H);
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 48, 48);
        const d = ctx.getImageData(0, 0, 48, 48).data;
        for (let i = 0; i < 48 * 48; i++) pixels[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
        const probs = net.predict(pixels);
        onFrame({ smile: smileEma(probs[iHappy]), surprise: surpriseEma(probs[iSurprise]), faceFound: true });
      } catch {
        /* skip this frame */
      } finally {
        busy = false;
      }
    }, 1000 / FPS);
    return () => clearInterval(timer);
  },
};
