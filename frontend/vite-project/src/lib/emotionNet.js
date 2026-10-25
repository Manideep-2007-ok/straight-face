// Runs the exported emotion CNN (see model/export.py) in plain JavaScript. No ML runtime needed.
// Input: 48x48 grayscale face as Float32Array scaled 0..1. Output: probabilities in the order of manifest.classes.

export function buildNet(manifest, weightsBuffer) {
  const w = new Float32Array(weightsBuffer);
  let off = 0;
  const take = (n) => {
    const a = w.subarray(off, off + n);
    off += n;
    return a;
  };
  const layers = manifest.layers.map((l) => {
    if (l.type === 'conv3x3') return { ...l, w: take(l.out * l.in * 9), b: take(l.out) };
    if (l.type === 'dense') return { ...l, w: take(l.out * l.in), b: take(l.out) };
    return l;
  });
  if (off !== w.length) throw new Error(`weights size mismatch: used ${off} of ${w.length}`);

  function conv3x3(x, H, W, l) {
    const { in: cin, out: cout, w: wt, b } = l;
    const y = new Float32Array(cout * H * W);
    for (let co = 0; co < cout; co++) {
      const yo = co * H * W;
      y.fill(b[co], yo, yo + H * W);
      for (let ci = 0; ci < cin; ci++) {
        const xo = ci * H * W;
        const wo = (co * cin + ci) * 9;
        for (let ky = 0; ky < 3; ky++) {
          for (let kx = 0; kx < 3; kx++) {
            const k = wt[wo + ky * 3 + kx];
            if (k === 0) continue;
            const dy = ky - 1;
            const dx = kx - 1;
            const y0 = Math.max(0, -dy);
            const y1 = Math.min(H, H - dy);
            const x0 = Math.max(0, -dx);
            const x1 = Math.min(W, W - dx);
            for (let yy = y0; yy < y1; yy++) {
              let xi = xo + (yy + dy) * W + x0 + dx;
              let yi = yo + yy * W + x0;
              for (let xx = x0; xx < x1; xx++) y[yi++] += k * x[xi++];
            }
          }
        }
      }
      for (let i = yo; i < yo + H * W; i++) if (y[i] < 0) y[i] = 0; // ReLU
    }
    return y;
  }

  function maxpool2(x, C, H, W) {
    const h = H >> 1;
    const ww = W >> 1;
    const y = new Float32Array(C * h * ww);
    for (let c = 0; c < C; c++) {
      for (let i = 0; i < h; i++) {
        for (let j = 0; j < ww; j++) {
          const p = c * H * W + 2 * i * W + 2 * j;
          y[c * h * ww + i * ww + j] = Math.max(x[p], x[p + 1], x[p + W], x[p + W + 1]);
        }
      }
    }
    return y;
  }

  return function predict(pixels01) {
    let x = pixels01;
    let C = 1;
    let H = manifest.input[0];
    let W = manifest.input[1];
    for (const l of layers) {
      if (l.type === 'conv3x3') {
        x = conv3x3(x, H, W, l);
        C = l.out;
      } else if (l.type === 'maxpool2') {
        x = maxpool2(x, C, H, W);
        H >>= 1;
        W >>= 1;
      } else if (l.type === 'gap') {
        const g = new Float32Array(C);
        for (let c = 0; c < C; c++) {
          let s = 0;
          for (let i = 0; i < H * W; i++) s += x[c * H * W + i];
          g[c] = s / (H * W);
        }
        x = g;
      } else if (l.type === 'dense') {
        const y = new Float32Array(l.out);
        for (let o = 0; o < l.out; o++) {
          let s = l.b[o];
          for (let i = 0; i < l.in; i++) s += l.w[o * l.in + i] * x[i];
          y[o] = l.relu && s < 0 ? 0 : s;
        }
        x = y;
      } else if (l.type === 'softmax') {
        const m = Math.max(...x);
        const e = Array.from(x, (v) => Math.exp(v - m));
        const sum = e.reduce((a, b) => a + b, 0);
        x = Float32Array.from(e, (v) => v / sum);
      }
    }
    return x;
  };
}

let cached;
export async function loadEmotionNet(base = '/model') {
  if (!cached) {
    cached = (async () => {
      const [manifest, buf] = await Promise.all([
        fetch(`${base}/manifest.json`).then((r) => r.json()),
        fetch(`${base}/weights.bin`).then((r) => r.arrayBuffer()),
      ]);
      return { classes: manifest.classes, predict: buildNet(manifest, buf) };
    })();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}
