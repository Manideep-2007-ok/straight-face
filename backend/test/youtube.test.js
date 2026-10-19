import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeId } from '../logic/youtube.js';
import { schemas } from '../sockets/schemas.js';

test('parseYouTubeId handles ids and common URL shapes', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(parseYouTubeId(id), id);
  assert.equal(parseYouTubeId(`https://www.youtube.com/watch?v=${id}&t=10`), id);
  assert.equal(parseYouTubeId(`https://youtu.be/${id}?si=abc`), id);
  assert.equal(parseYouTubeId(`https://m.youtube.com/shorts/${id}`), id);
  assert.equal(parseYouTubeId(`https://www.youtube.com/embed/${id}`), id);
});

test('parseYouTubeId rejects junk and other hosts', () => {
  assert.equal(parseYouTubeId('hello'), null);
  assert.equal(parseYouTubeId('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=short'), null);
  assert.equal(parseYouTubeId(42), null);
});

test('socket schemas: strict, bounded, reject unknown fields', () => {
  assert.equal(schemas['chat:send'].safeParse({ text: '  hi  ' }).data.text, 'hi');
  assert.equal(schemas['chat:send'].safeParse({ text: '' }).success, false);
  assert.equal(schemas['chat:send'].safeParse({ text: 'x'.repeat(501) }).success, false);
  assert.equal(schemas['chat:send'].safeParse({ text: 'hi', extra: 1 }).success, false);
  assert.equal(schemas['play:set'].safeParse({ status: 'playing', position: -1 }).success, false);
  assert.equal(schemas['play:set'].safeParse({ status: 'playing', videoId: 'bad' }).success, false);
  assert.equal(schemas['room:join'].safeParse({ code: 'abc234' }).data.code, 'ABC234');
  assert.equal(schemas['room:join'].safeParse({ code: 'ABC10O' }).success, false);
});
