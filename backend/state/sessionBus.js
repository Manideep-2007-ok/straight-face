import { EventEmitter } from 'node:events';
import { User } from '../models/index.js';

// One login per account. Every login makes a new session id; only the newest one is valid, so opening the same account
// on a second device signs the first one out immediately (REST calls get 401 SESSION_REPLACED and its socket is closed).
export const sessionBus = new EventEmitter();

const cache = new Map(); // userId -> current session id (memory first, database as the source of truth)

export async function currentSid(userId) {
  const key = String(userId);
  if (cache.has(key)) return cache.get(key);
  const u = await User.findById(key).select('sessionId').lean().catch(() => null);
  if (u?.sessionId) cache.set(key, u.sessionId);
  return u?.sessionId || null;
}

export async function startSession(userId, sid) {
  const key = String(userId);
  await User.updateOne({ _id: key }, { sessionId: sid });
  cache.set(key, sid);
  sessionBus.emit('replaced', { userId: key, sid });
}
