"""Export the trained CNN for the browser.

Folds each BatchNorm into the convolution before it, then writes:
  frontend/vite-project/public/model/weights.bin   float32, layers in order (weights then bias)
  frontend/vite-project/public/model/manifest.json layer list and shapes
  frontend/vite-project/public/model/parity.json   5 test faces + PyTorch outputs, to check the JS matches

Run:  .venv/bin/python -I export.py                 (after train.py, uses out/best.pt)
      .venv/bin/python -I export.py --name gpu1     (after train_gpu.py, uses out/gpu1/best.pt and out/gpu1/metrics.json)
Works for any widths: they are read from the saved weights.
"""
import argparse
import io
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--name", default=None)
args = ap.parse_args()
ROOT = Path(__file__).resolve().parent
RUN = ROOT / "out" / args.name if args.name else ROOT / "out"
DEST = ROOT.parent / "frontend" / "vite-project" / "public" / "model"
DEST.mkdir(parents=True, exist_ok=True)


def block(cin, cout):
    return [
        nn.Conv2d(cin, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
        nn.Conv2d(cout, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
        nn.MaxPool2d(2), nn.Dropout(0.25),
    ]


class Net(nn.Module):  # must match train.py / train_gpu.py
    def __init__(self, w=(32, 64, 128)):
        super().__init__()
        self.features = nn.Sequential(*block(1, w[0]), *block(w[0], w[1]), *block(w[1], w[2]))
        self.head = nn.Sequential(nn.Linear(w[2], 128), nn.ReLU(inplace=True), nn.Dropout(0.5), nn.Linear(128, 4))

    def forward(self, x):
        return self.head(self.features(x).mean(dim=(2, 3)))


sd = torch.load(RUN / "best.pt", map_location="cpu", weights_only=True)
widths = [sd["features.0.weight"].shape[0], sd["features.8.weight"].shape[0], sd["features.16.weight"].shape[0]]
net = Net(widths)
net.load_state_dict(sd)
net.eval()

layers, blobs = [], []
mods = list(net.features)
i = 0
while i < len(mods):
    m = mods[i]
    if isinstance(m, nn.Conv2d):
        bn = mods[i + 1]
        scale = bn.weight.detach() / torch.sqrt(bn.running_var + bn.eps)
        w = (m.weight.detach() * scale.view(-1, 1, 1, 1)).numpy().astype("<f4")
        b = (bn.bias.detach() - bn.running_mean * scale).numpy().astype("<f4")
        layers.append({"type": "conv3x3", "in": m.in_channels, "out": m.out_channels})
        blobs += [w.ravel(), b.ravel()]
        i += 3  # conv, bn, relu
    elif isinstance(m, nn.MaxPool2d):
        layers.append({"type": "maxpool2"})
        i += 1
    else:
        i += 1  # dropout: no-op at inference
layers.append({"type": "gap"})
for lin, relu in [(net.head[0], True), (net.head[3], False)]:
    layers.append({"type": "dense", "in": lin.in_features, "out": lin.out_features, "relu": relu})
    blobs += [lin.weight.detach().numpy().astype("<f4").ravel(), lin.bias.detach().numpy().astype("<f4").ravel()]
layers.append({"type": "softmax"})

(DEST / "weights.bin").write_bytes(np.concatenate(blobs).tobytes())
metrics = json.loads((RUN / "metrics.json").read_text())
(DEST / "manifest.json").write_text(json.dumps({
    "input": [48, 48], "classes": metrics["classes"], "layers": layers,
    "floats": int(sum(b.size for b in blobs)),
}, indent=1))

# Parity samples from the test set (privateTest).
df = pd.read_parquet(next((ROOT / "data" / "raw").glob("privateTest-*.parquet")))
rng = np.random.default_rng(7)
samples = []
for idx in rng.choice(len(df), 5, replace=False):
    img = np.array(Image.open(io.BytesIO(df.iloc[idx]["image"]["bytes"])).convert("L").resize((48, 48)))
    x = torch.from_numpy(img).float().div(255).view(1, 1, 48, 48)
    with torch.no_grad():
        logits = net(x)[0]
    samples.append({"pixels": img.ravel().tolist(), "probs": torch.softmax(logits, 0).tolist()})
(DEST / "parity.json").write_text(json.dumps(samples))
print("widths", widths, "wrote", DEST, "floats", sum(b.size for b in blobs), "bytes", (DEST / "weights.bin").stat().st_size)
