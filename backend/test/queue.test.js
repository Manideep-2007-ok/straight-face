import test from 'node:test';
import assert from 'node:assert/strict';
import { addItem, toggleVote, popNext, ranked, publicQueue, MAX_QUEUE } from '../logic/queue.js';

const add = (q, videoId, userId = 'a', id = videoId) => addItem(q, { videoId, title: `T ${videoId}`, userId, name: userId }, id);

test('adding puts the adder as the first voter and rejects duplicates', () => {
  let r = add([], 'aaaaaaaaaaa');
  assert.equal(r.queue.length, 1);
  assert.deepEqual(r.item.voters, ['a']);
  const dup = add(r.queue, 'aaaaaaaaaaa', 'b');
  assert.equal(dup.error, 'ALREADY_QUEUED');
  assert.equal(dup.queue.length, 1);
});

test('queue is capped', () => {
  let q = [];
  for (let i = 0; i < MAX_QUEUE; i++) q = add(q, String(i).padStart(11, 'x')).queue;
  assert.equal(add(q, 'zzzzzzzzzzz').error, 'QUEUE_FULL');
});

test('voting toggles and unknown ids are rejected', () => {
  let q = add([], 'aaaaaaaaaaa').queue;
  q = toggleVote(q, 'aaaaaaaaaaa', 'b').queue;
  assert.equal(q[0].voters.length, 2);
  q = toggleVote(q, 'aaaaaaaaaaa', 'b').queue;
  assert.equal(q[0].voters.length, 1);
  assert.equal(toggleVote(q, 'nope', 'b').error, 'NOT_FOUND');
});

test('most votes first, ties keep the order added; popNext takes the top', () => {
  let q = add([], 'aaaaaaaaaaa').queue;
  q = add(q, 'bbbbbbbbbbb', 'b').queue;
  q = add(q, 'ccccccccccc', 'c').queue;
  q = toggleVote(q, 'ccccccccccc', 'a').queue; // c has 2 votes
  assert.deepEqual(ranked(q).map((x) => x.videoId), ['ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb']);
  const { queue, next } = popNext(q);
  assert.equal(next.videoId, 'ccccccccccc');
  assert.equal(queue.length, 2);
  assert.equal(popNext([]).next, null);
  assert.equal(publicQueue(q)[0].votes, 2);
});
