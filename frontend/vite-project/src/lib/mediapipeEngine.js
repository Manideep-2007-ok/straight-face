import { scoresFromBlendshapes, makeEma, FPS } from './face.js';

// EmotionEngine "mediapipe": pretrained MediaPipe FaceLandmarker. Nothing here is trained by this project.
// start(videoEl, onFrame) -> stop(). onFrame({ smile, surprise, faceFound }) runs about 8 times a second.
let landmarkerPromise;
async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
    })();
    landmarkerPromise.catch(() => {
      landmarkerPromise = null;
    });
  }
  return landmarkerPromise;
}

export const mediapipeEngine = {
  name: 'mediapipe',
  preload: getLandmarker,
  async start(video, onFrame) {
    const landmarker = await getLandmarker();
    const smileEma = makeEma();
    const surpriseEma = makeEma();
    let lastVideoTime = -1;
    const timer = setInterval(() => {
      if (video.readyState < 2 || video.videoWidth === 0 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      let result;
      try {
        result = landmarker.detectForVideo(video, performance.now());
      } catch {
        return;
      }
      const cats = result.faceBlendshapes?.[0]?.categories;
      if (!cats) return onFrame({ smile: 0, surprise: 0, faceFound: false });
      const shapes = Object.fromEntries(cats.map((c) => [c.categoryName, c.score]));
      const raw = scoresFromBlendshapes(shapes);
      onFrame({ smile: smileEma(raw.smile), surprise: surpriseEma(raw.surprise), faceFound: true });
    }, 1000 / FPS);
    return () => clearInterval(timer);
  },
};
