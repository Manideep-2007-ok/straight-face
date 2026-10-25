"""Train a small CNN on FER2013 (48x48 grayscale faces) to tell happy / surprise / neutral / other.

Plan steps B2-B8:
  B2 look at the data   B3 merge to 4 classes   B4 split (test touched once)
  B5 baseline           B6 CNN                  B7 train      B8 test once

Run:  .venv/bin/python -I train.py
Outputs go to model/out/ (metrics.json, curves.png, confusion_matrix.png, samples.png, best.pt).
"""
import io
import json
import time
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from sklearn.metrics import confusion_matrix
from sklearn.model_selection import train_test_split

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)

SEED = 42
torch.manual_seed(SEED)
np.random.seed(SEED)

ORIG = ["angry", "disgust", "fear", "happy", "sad", "surprise", "neutral"]
CLASSES = ["happy", "surprise", "neutral", "other"]
# original label -> merged label: happy, surprise, neutral keep their own class; the rest are "other".
MERGE = {0: 3, 1: 3, 2: 3, 3: 0, 4: 3, 5: 1, 6: 2}


def load(prefix):
    path = next(RAW.glob(f"{prefix}-*.parquet"))
    df = pd.read_parquet(path)
    imgs = np.stack([np.array(Image.open(io.BytesIO(d["bytes"])).convert("L").resize((48, 48))) for d in df["image"]])
    return imgs.astype(np.uint8), df["label"].to_numpy().astype(int)


print("== B2 load and look at the data")
x_tr, y_tr = load("train")
x_pub, y_pub = load("publicTest")
x_te, y_te = load("privateTest")
print("train", x_tr.shape, "publicTest", x_pub.shape, "privateTest", x_te.shape)
print("original class counts (train):", {ORIG[i]: int((y_tr == i).sum()) for i in range(7)})
print("-> disgust is tiny next to happy: the data is imbalanced, so a model can look good by ignoring rare classes.")

rng = np.random.default_rng(SEED)
pick = rng.choice(len(x_tr), 16, replace=False)
fig, axes = plt.subplots(2, 8, figsize=(12, 3.6))
for a, i in zip(axes.ravel(), pick):
    a.imshow(x_tr[i], cmap="gray")
    a.set_title(ORIG[y_tr[i]], fontsize=8)
    a.axis("off")
plt.tight_layout()
plt.savefig(OUT / "samples.png", dpi=110)
plt.close()

print("== B3 merge to 4 classes")
m = np.vectorize(MERGE.get)
y_tr, y_pub, y_te = m(y_tr), m(y_pub), m(y_te)
for name, y in [("train", y_tr), ("publicTest", y_pub), ("privateTest", y_te)]:
    print(name, {CLASSES[i]: int((y == i).sum()) for i in range(4)})

print("== B4 split: train + publicTest pooled, 10% stratified validation; privateTest is the untouched test set")
x_pool = np.concatenate([x_tr, x_pub])
y_pool = np.concatenate([y_tr, y_pub])
x_train, x_val, y_train, y_val = train_test_split(x_pool, y_pool, test_size=0.10, stratify=y_pool, random_state=SEED)
print("sizes  train", len(x_train), " val", len(x_val), " test", len(x_te))

print("== B5 baseline: always guess the biggest class")
biggest = int(np.bincount(y_train).argmax())
baseline = float((y_te == biggest).mean())
print(f"biggest class = {CLASSES[biggest]}, test accuracy by guessing it = {baseline:.4f}")


def to_t(x):
    return torch.from_numpy(x).float().div(255.0).unsqueeze(1)


Xtr, Xva, Xte = to_t(x_train), to_t(x_val), to_t(x_te)
Ytr, Yva, Yte = map(torch.from_numpy, (y_train, y_val, y_te))


def block(cin, cout):
    return [
        nn.Conv2d(cin, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
        nn.Conv2d(cout, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
        nn.MaxPool2d(2), nn.Dropout(0.25),
    ]


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(*block(1, 32), *block(32, 64), *block(64, 128))
        self.head = nn.Sequential(nn.Linear(128, 128), nn.ReLU(inplace=True), nn.Dropout(0.5), nn.Linear(128, 4))

    def forward(self, x):
        x = self.features(x)
        x = x.mean(dim=(2, 3))  # global average pooling
        return self.head(x)


def augment(x):
    """Flip, +-10 degree rotation, 10% zoom, small brightness change. Applied per batch on the fly."""
    n = x.size(0)
    flip = torch.rand(n) < 0.5
    x = torch.where(flip.view(-1, 1, 1, 1), x.flip(3), x)
    ang = (torch.rand(n) * 2 - 1) * (10 * np.pi / 180)
    scale = 1 + (torch.rand(n) * 2 - 1) * 0.10
    cos, sin = torch.cos(ang) / scale, torch.sin(ang) / scale
    theta = torch.zeros(n, 2, 3)
    theta[:, 0, 0], theta[:, 0, 1], theta[:, 1, 0], theta[:, 1, 1] = cos, -sin, sin, cos
    grid = F.affine_grid(theta, x.shape, align_corners=False)
    x = F.grid_sample(x, grid, padding_mode="border", align_corners=False)
    x = x * (1 + (torch.rand(n, 1, 1, 1) * 2 - 1) * 0.15)
    return x.clamp(0, 1)


model = Net()
n_params = sum(p.numel() for p in model.parameters())
print(f"== B6 model: {n_params:,} parameters")
print(model)

counts = np.bincount(y_train, minlength=4)
weights = torch.tensor(len(y_train) / (4 * counts), dtype=torch.float32)
print("class weights", {CLASSES[i]: round(float(weights[i]), 3) for i in range(4)})
loss_fn = nn.CrossEntropyLoss(weight=weights)
opt = torch.optim.Adam(model.parameters(), lr=1e-3)
sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, factor=0.5, patience=3)


@torch.no_grad()
def evaluate(X, Y):
    model.eval()
    logits = torch.cat([model(X[i : i + 512]) for i in range(0, len(X), 512)])
    return loss_fn(logits, Y).item(), (logits.argmax(1) == Y).float().mean().item(), logits


print("== B7 train (<= 40 epochs, early stopping patience 6)")
hist = {"train_loss": [], "val_loss": [], "train_acc": [], "val_acc": []}
best = {"val_loss": 1e9, "state": None, "epoch": 0}
bad = 0
BS = 128
t0 = time.time()
for epoch in range(1, 41):
    model.train()
    perm = torch.randperm(len(Xtr))
    tl, tc = 0.0, 0
    for i in range(0, len(perm), BS):
        idx = perm[i : i + BS]
        xb, yb = augment(Xtr[idx]), Ytr[idx]
        opt.zero_grad()
        out = model(xb)
        loss = loss_fn(out, yb)
        loss.backward()
        opt.step()
        tl += loss.item() * len(idx)
        tc += (out.argmax(1) == yb).sum().item()
    vl, va, _ = evaluate(Xva, Yva)
    sched.step(vl)
    hist["train_loss"].append(tl / len(perm))
    hist["train_acc"].append(tc / len(perm))
    hist["val_loss"].append(vl)
    hist["val_acc"].append(va)
    print(f"epoch {epoch:2d}  train loss {tl/len(perm):.3f} acc {tc/len(perm):.3f} | val loss {vl:.3f} acc {va:.3f} | lr {opt.param_groups[0]['lr']:.5f} | {time.time()-t0:.0f}s", flush=True)
    if vl < best["val_loss"] - 1e-4:
        best.update(val_loss=vl, state={k: v.clone() for k, v in model.state_dict().items()}, epoch=epoch)
        bad = 0
    else:
        bad += 1
        if bad >= 6:
            print("early stopping")
            break

model.load_state_dict(best["state"])
torch.save(best["state"], OUT / "best.pt")
print(f"restored best epoch {best['epoch']} (val loss {best['val_loss']:.3f})")

fig, ax = plt.subplots(1, 2, figsize=(10, 3.4))
ax[0].plot(hist["train_loss"], label="train")
ax[0].plot(hist["val_loss"], label="validation")
ax[0].set_title("Loss")
ax[0].legend()
ax[1].plot(hist["train_acc"], label="train")
ax[1].plot(hist["val_acc"], label="validation")
ax[1].set_title("Accuracy")
ax[1].legend()
plt.tight_layout()
plt.savefig(OUT / "curves.png", dpi=110)
plt.close()

print("== B8 test ONCE on the untouched privateTest set")
tl_, ta, logits = evaluate(Xte, Yte)
pred = logits.argmax(1).numpy()
cm = confusion_matrix(y_te, pred, labels=range(4))
recall = {CLASSES[i]: float(cm[i, i] / cm[i].sum()) for i in range(4)}
precision = {CLASSES[i]: float(cm[i, i] / max(1, cm[:, i].sum())) for i in range(4)}
print(f"test accuracy {ta:.4f}  (baseline {baseline:.4f})")
print("recall   ", {k: round(v, 3) for k, v in recall.items()})
print("precision", {k: round(v, 3) for k, v in precision.items()})
print(cm)

fig, ax = plt.subplots(figsize=(4.6, 4.2))
ax.imshow(cm, cmap="Oranges")
ax.set_xticks(range(4), CLASSES, rotation=30)
ax.set_yticks(range(4), CLASSES)
ax.set_xlabel("predicted")
ax.set_ylabel("true")
for i in range(4):
    for j in range(4):
        ax.text(j, i, cm[i, j], ha="center", va="center", color="black", fontsize=9)
ax.set_title(f"Test confusion matrix (accuracy {ta:.1%})")
plt.tight_layout()
plt.savefig(OUT / "confusion_matrix.png", dpi=120)
plt.close()

(OUT / "metrics.json").write_text(json.dumps({
    "classes": CLASSES,
    "parameters": n_params,
    "sizes": {"train": len(x_train), "val": len(x_val), "test": len(x_te)},
    "baseline_accuracy": baseline,
    "best_epoch": best["epoch"],
    "epochs_run": len(hist["val_loss"]),
    "val_accuracy_best": hist["val_acc"][best["epoch"] - 1],
    "test_accuracy": ta,
    "test_recall": recall,
    "test_precision": precision,
    "confusion_matrix": cm.tolist(),
}, indent=2))
print("saved to", OUT)
