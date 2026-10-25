import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { buildNet } from './emotionNet.js';

const dir = new URL('../../public/model/', import.meta.url);
const ready = existsSync(new URL('weights.bin', dir));

// The JavaScript network must give the same answers as the PyTorch model it was exported from.
test('JS network matches PyTorch outputs on 5 test faces', { skip: !ready && 'model not exported yet' }, () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
  const buf = readFileSync(new URL('weights.bin', dir));
  const predict = buildNet(manifest, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const samples = JSON.parse(readFileSync(new URL('parity.json', dir), 'utf8'));
  for (const s of samples) {
    const probs = predict(Float32Array.from(s.pixels, (v) => v / 255));
    assert.equal(probs.length, 4);
    let sum = 0;
    probs.forEach((p, i) => {
      sum += p;
      assert.ok(Math.abs(p - s.probs[i]) < 1e-3, `class ${i}: js ${p} vs torch ${s.probs[i]}`);
    });
    assert.ok(Math.abs(sum - 1) < 1e-4);
  }
});
