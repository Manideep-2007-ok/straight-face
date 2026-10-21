import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOffset, driftAction, expectedPosition, visibleMessages } from './sync.js';

test('computeOffset uses the sample with the lowest round trip', () => {
  const samples = [
    { c0: 1000, s: 5500, c1: 1400 }, // rtt 400, offset 4300
    { c0: 2000, s: 6020, c1: 2040 }, // rtt 40,  offset 4000
    { c0: 3000, s: 7300, c1: 3300 }, // rtt 300
  ];
  assert.equal(computeOffset(samples), 4000);
  assert.equal(computeOffset([]), 0);
});

test('driftAction thresholds', () => {
  assert.deepEqual(driftAction(0.1), { type: 'none' });
  assert.deepEqual(driftAction(0.5), { type: 'rate', rate: 0.95 });
  assert.deepEqual(driftAction(-0.5), { type: 'rate', rate: 1.05 });
  assert.deepEqual(driftAction(1.3), { type: 'seek' });
  assert.deepEqual(driftAction(-2), { type: 'seek' });
});

test('expectedPosition mirrors the server', () => {
  const s = { status: 'playing', position: 10, updatedAtServer: 1000 };
  assert.equal(expectedPosition(s, 3000), 12);
  assert.equal(expectedPosition({ ...s, status: 'paused' }, 3000), 10);
});

test('visibleMessages hides messages from later in the same video only', () => {
  const msgs = [
    { videoId: 'v', t: 5 },
    { videoId: 'v', t: 100 },
    { videoId: 'other', t: 500 },
  ];
  const { shown, hidden } = visibleMessages(msgs, 10, 'v');
  assert.equal(shown.length, 2);
  assert.equal(hidden, 1);
});
