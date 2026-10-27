import { Server } from 'socket.io';
import { parseCookie } from 'cookie';
import { User, Room, PartySession, ChatMessage, GameRound, ReactionEvent } from '../models/index.js';
import { verifyToken } from '../middleware/index.js';
import { initialPlayback, expectedPosition, applyAction } from '../logic/playbackState.js';
import { RateBucket } from '../logic/rateBucket.js';
import * as dl from '../logic/dontLaugh.js';
import * as qu from '../logic/queue.js';
import { schemas } from './schemas.js';

const FLUSH_MS = 3000;
const FLUSH_AT = 50;

export function attachSockets(httpServer, config, registry) {
  const io = new Server(httpServer, {
    cors: { origin: config.allowedOrigins, credentials: true },
    maxHttpBufferSize: 100 * 1024,
  });

  // Live state per room code. Mongo keeps history; this is the fast truth.
  const live = new Map();
  const getLive = (code) => {
    if (!live.has(code)) {
      live.set(code, { playback: initialPlayback(null), toggles: new Map(), sessionId: null, chat: [], recent: [], round: dl.idleRound(), queue: [], share: null, events: [], radar: new Map(), lastLive: 0, roundStartedAt: null, roundTimer: null, thresholds: {} });
    }
    return live.get(code);
  };

  async function flush(code) {
    const L = live.get(code);
    if (!L) return;
    if (L.chat.length) {
      const batch = L.chat.splice(0, L.chat.length);
      await ChatMessage.insertMany(batch, { ordered: false }).catch((e) => console.error('chat flush failed', e.message));
    }
    if (L.events.length) {
      const batch = L.events.splice(0, L.events.length);
      await ReactionEvent.insertMany(batch, { ordered: false }).catch((e) => console.error('event flush failed', e.message));
    }
  }
  const broadcastRound = (code) => io.to(code).emit('dl:state', dl.publicView(getLive(code).round));

  async function saveRound(code) {
    const L = getLive(code);
    const r = L.round;
    if (r.phase !== 'ended' || !L.sessionId) return;
    await GameRound.create({
      sessionId: L.sessionId,
      videoId: L.playback.videoId,
      config: { baselineSec: 3, smileThreshold: r.config?.smileThreshold ?? 0.35, holdFrames: 3 },
      startedAt: L.roundStartedAt,
      endedAt: new Date(),
      outcomes: Object.values(r.players).map((p) => ({ userId: p.userId, name: p.name, outAtT: p.outAtT, peak: p.peak })),
      winners: r.winners,
    }).catch((e) => console.error('save round failed', e.message));
  }

  async function setRound(code, next) {
    const L = getLive(code);
    const wasEnded = L.round.phase === 'ended';
    L.round = next;
    broadcastRound(code);
    if (next.phase === 'ended' && !wasEnded) {
      clearTimeout(L.roundTimer);
      await saveRound(code);
    }
  }

  const timer = setInterval(() => live.forEach((_, code) => flush(code)), FLUSH_MS);
  timer.unref();

  io.use(async (socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie || '');
    const userId = verifyToken(cookies.token, config.JWT_SECRET);
    if (!userId) return next(new Error('auth_error'));
    const user = await User.findById(userId).lean().catch(() => null);
    if (!user) return next(new Error('auth_error'));
    socket.user = { userId: String(user._id), name: user.name };
    next();
  });

  io.on('connection', (socket) => {
    const bucket = new RateBucket(30, 30);
    const chatBucket = new RateBucket(5, 1);
    let code = null;

    // Wrap a handler: rate limit, zod-validate, never throw into the socket.
    const on = (event, handler, { chat = false } = {}) => {
      const schema = schemas[event];
      socket.on(event, async (payload, ack) => {
        // A client that sends no payload passes the ack function as the first argument.
        if (typeof payload === 'function') {
          ack = payload;
          payload = undefined;
        }
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!bucket.take() || (chat && !chatBucket.take())) return reply({ error: 'RATE_LIMITED' });
        const parsed = schema.safeParse(payload);
        if (!parsed.success) return reply({ error: 'BAD_PAYLOAD' });
        try {
          await handler(parsed.data, reply);
        } catch (e) {
          console.error(event, e);
          reply({ error: 'INTERNAL' });
        }
      });
    };

    const members = () => registry.members(code).map((m) => ({ userId: m.userId, name: m.name }));
    const stampNow = () => Date.now();

    // Ends the screen/file share (if it is mine or `force`) and pauses the room clock at where it had got to.
    function endShare(c, force = false) {
      const L = live.get(c);
      if (!L?.share || (!force && L.share.userId !== socket.user.userId)) return false;
      L.share = null;
      const now = Date.now();
      L.playback = { ...L.playback, position: expectedPosition(L.playback, now), status: 'paused', updatedAtServer: now, version: L.playback.version + 1 };
      io.to(c).emit('share:state', null);
      io.to(c).emit('play:state', L.playback);
      return true;
    }

    async function leave() {
      if (!code) return;
      const c = code;
      endShare(c);
      code = null;
      socket.leave(c);
      if (registry.leave(c, socket.user.userId, socket.id)) {
        io.to(c).emit('room:members', registry.members(c).map((m) => ({ userId: m.userId, name: m.name })));
        const L0 = live.get(c);
        if (L0 && L0.round.phase !== 'idle') {
          await setRound(c, dl.playerLeft(L0.round, socket.user.userId, { now: Date.now(), playbackPos: expectedPosition(L0.playback, Date.now()) }));
        }
        if (registry.memberCount(c) === 0) {
          await flush(c);
          const L = live.get(c);
          if (L?.sessionId) {
            const q = { sessionId: L.sessionId };
            const [hasChat, hasEvents, hasRounds] = await Promise.all([ChatMessage.exists(q), ReactionEvent.exists(q), GameRound.exists(q)]).catch(() => [true]);
            if (!hasChat && !hasEvents && !hasRounds) await PartySession.deleteOne({ _id: L.sessionId }).catch(() => {}); // nothing happened: no recap needed
            else await PartySession.updateOne({ _id: L.sessionId }, { endedAt: new Date() }).catch(() => {});
          }
          clearTimeout(live.get(c)?.roundTimer);
          live.delete(c);
        }
      }
    }

    on('clock:ping', ({ c }, reply) => reply({ c, s: Date.now() }));

    on('room:join', async ({ code: wanted }, reply) => {
      const room = await Room.findOne({ code: wanted });
      if (!room) return reply({ error: 'NOT_FOUND' });
      if (code && code !== wanted) await leave();
      const res = registry.join(wanted, socket.user, socket.id);
      if (!res.ok) return reply({ error: res.error });
      code = wanted;
      socket.join(code);
      await Room.updateOne({ _id: room._id }, { $addToSet: { memberIds: socket.user.userId }, lastActiveAt: new Date() });
      const L = getLive(code);
      if (!L.sessionId) {
        const s = await PartySession.create({ roomId: room._id });
        L.sessionId = s._id;
      }
      await PartySession.updateOne(
        { _id: L.sessionId, 'participants.userId': { $ne: socket.user.userId } },
        { $push: { participants: { userId: socket.user.userId, name: socket.user.name } } },
      );
      io.to(code).emit('room:members', members());
      reply({
        ok: true,
        room: { code, name: room.name },
        me: socket.user,
        state: L.playback,
        serverNow: stampNow(),
        members: members(),
        chat: L.recent.slice(-50),
        round: dl.publicView(L.round),
        queue: qu.publicQueue(L.queue),
        share: L.share,
      });
    });

    on('room:leave', async (_p, reply) => {
      await leave();
      reply({ ok: true });
    });

    const playHandler = (kind) => async (data, reply) => {
      if (!code) return reply({ error: 'NOT_IN_ROOM' });
      const L = getLive(code);
      if (L.share) return reply({ error: 'SHARING', state: L.playback });
      const now = stampNow();
      const action =
        kind === 'set'
          ? { kind: 'set', status: data.status, position: data.position ?? expectedPosition(L.playback, now), videoId: data.videoId }
          : { kind: 'seek', position: data.position };
      const r = applyAction(L.playback, action, {
        userId: socket.user.userId,
        name: socket.user.name,
        now,
        lastToggleAt: L.toggles.get(socket.user.userId) ?? 0,
      });
      if (r.accepted) {
        L.playback = r.state;
        if (r.toggledAt) L.toggles.set(socket.user.userId, r.toggledAt);
        io.to(code).emit('play:state', L.playback);
        return reply({ ok: true, state: L.playback });
      }
      // Rejected: send the sender the truth so their UI snaps back.
      reply({ ok: false, reason: r.reason, state: L.playback });
      if (r.reason === 'COOLDOWN') socket.emit('play:state', L.playback);
    };
    on('play:set', playHandler('set'));
    on('play:seek', playHandler('seek'));

    on(
      'chat:send',
      ({ text }, reply) => {
        if (!code) return reply({ error: 'NOT_IN_ROOM' });
        const L = getLive(code);
        const t = expectedPosition(L.playback, stampNow());
        const msg = {
          sessionId: L.sessionId,
          userId: socket.user.userId,
          name: socket.user.name,
          text,
          videoId: L.playback.videoId,
          t,
          createdAt: new Date(),
        };
        L.chat.push(msg);
        L.recent.push({ ...msg, sessionId: undefined });
        if (L.recent.length > 100) L.recent.shift();
        io.to(code).emit('chat:new', { ...msg, sessionId: undefined });
        if (L.chat.length >= FLUSH_AT) flush(code);
        reply({ ok: true });
      },
      { chat: true },
    );

    const needRoom = (reply) => (code ? true : (reply({ error: 'NOT_IN_ROOM' }), false));

    on('dl:start', async ({ smileThreshold }, reply) => {
      if (!needRoom(reply)) return;
      const L = getLive(code);
      if (L.round.phase === 'calibrating' || L.round.phase === 'countdown' || L.round.phase === 'live') return reply({ error: 'ROUND_ACTIVE' });
      if (!L.playback.videoId) return reply({ error: 'NO_VIDEO' });
      if (registry.memberCount(code) < dl.MIN_PLAYERS) return reply({ error: 'NEED_PLAYERS' });
      clearTimeout(L.roundTimer);
      L.thresholds = {};
      await setRound(code, dl.startRound(members(), { smileThreshold }));
      reply({ ok: true });
    });

    on('dl:calibrated', async ({ threshold }, reply) => {
      if (!needRoom(reply)) return;
      const L = getLive(code);
      L.thresholds[socket.user.userId] = threshold;
      await setRound(code, dl.markCalibrated(L.round, socket.user.userId));
      reply({ ok: true });
    });

    on('dl:begin', async (_p, reply) => {
      if (!needRoom(reply)) return;
      const L = getLive(code);
      const now = Date.now();
      const next = dl.beginCountdown(L.round, now);
      if (next.phase !== 'countdown') return reply({ error: 'NEED_PLAYERS' });
      await setRound(code, next);
      const c = code;
      L.roundTimer = setTimeout(async () => {
        const LL = live.get(c);
        if (!LL || LL.round.phase !== 'countdown') return;
        const t = Date.now();
        const r = applyAction(LL.playback, { kind: 'seek', position: 0 }, { userId: 'system', name: 'Don\'t Laugh', now: t });
        const r2 = applyAction(r.state, { kind: 'set', status: 'playing', position: 0 }, { userId: 'system', name: 'Don\'t Laugh', now: t, lastToggleAt: 0 });
        LL.playback = r2.accepted ? r2.state : r.state;
        io.to(c).emit('play:state', LL.playback);
        LL.roundStartedAt = new Date();
        await setRound(c, dl.goLive(LL.round));
      }, dl.COUNTDOWN_MS);
      reply({ ok: true });
    });

    on('dl:out', async ({ t, peak }, reply) => {
      if (!needRoom(reply)) return;
      const L = getLive(code);
      const now = Date.now();
      const r = dl.reportOut(L.round, socket.user.userId, { t, peak }, { now, playbackPos: expectedPosition(L.playback, now) });
      if (r.accepted) await setRound(code, r.state);
      reply({ ok: r.accepted, reason: r.reason });
    });

    on('dl:stop', async (_p, reply) => {
      if (!needRoom(reply)) return;
      await setRound(code, dl.stopRound(getLive(code).round));
      reply({ ok: true });
    });

    on('dl:cancel', async (_p, reply) => {
      if (!needRoom(reply)) return;
      const L = getLive(code);
      clearTimeout(L.roundTimer);
      await setRound(code, dl.idleRound());
      reply({ ok: true });
    });

    on('react:emoji', ({ emoji, auto, strength }, reply) => {
      if (!needRoom(reply)) return;
      const L = getLive(code);
      const kind = emoji === '😮' || emoji === '😱' ? 'surprise' : emoji === '😂' ? 'laugh' : emoji === '😄' ? 'smile' : 'emoji';
      const t = expectedPosition(L.playback, Date.now());
      io.to(code).emit('react:new', { userId: socket.user.userId, name: socket.user.name, emoji, auto: !!auto, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
      if (L.sessionId) {
        L.events.push({
          sessionId: L.sessionId, userId: socket.user.userId, kind: auto ? kind : 'emoji', emoji, videoId: L.playback.videoId,
          t: Math.floor(t), strength: strength ?? 0, source: auto ? 'auto' : 'manual',
        });
        if (L.events.length >= FLUSH_AT) flush(code);
      }
      reply({ ok: true });
    });

    // One sample per second per person, only while they have face reactions switched on.
    on('radar:sample', ({ t, smile, surprise }, reply) => {
      if (!needRoom(reply)) return;
      const L = getLive(code);
      const now = Date.now();
      L.radar.set(socket.user.userId, { smile, at: now });
      const pos = expectedPosition(L.playback, now);
      if (L.sessionId && L.playback.videoId && L.playback.status === 'playing') {
        if (smile >= 0.15) L.events.push({ sessionId: L.sessionId, userId: socket.user.userId, kind: 'laugh', videoId: L.playback.videoId, t: Math.floor(pos), strength: smile, source: 'auto' });
        if (surprise >= 0.5) L.events.push({ sessionId: L.sessionId, userId: socket.user.userId, kind: 'surprise', videoId: L.playback.videoId, t: Math.floor(pos), strength: surprise, source: 'auto' });
      }
      // Room glow: mean of everyone's last 3 s, sent at most 4 times a second.
      if (now - L.lastLive >= 250) {
        L.lastLive = now;
        const vals = [...L.radar.values()].filter((v) => now - v.at < 3000).map((v) => v.smile);
        const level = vals.length ? Math.min(1, vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
        io.to(code).emit('radar:live', { level });
      }
      reply({ ok: true });
    });

    const broadcastQueue = () => io.to(code).emit('queue:state', qu.publicQueue(getLive(code).queue));

    on('queue:add', ({ videoId, title }, reply) => {
      if (!needRoom(reply)) return;
      const L = getLive(code);
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const r = qu.addItem(L.queue, { videoId, title, userId: socket.user.userId, name: socket.user.name }, id);
      if (r.error) return reply({ error: r.error });
      L.queue = r.queue;
      broadcastQueue();
      reply({ ok: true });
    });

    on('queue:vote', ({ id }, reply) => {
      if (!needRoom(reply)) return;
      const L = getLive(code);
      const r = qu.toggleVote(L.queue, id, socket.user.userId);
      if (r.error) return reply({ error: r.error });
      L.queue = r.queue;
      broadcastQueue();
      reply({ ok: true });
    });

    // Play the top-voted video for everyone.
    on('queue:next', (_p, reply) => {
      if (!needRoom(reply)) return;
      const L = getLive(code);
      if (L.share) return reply({ error: 'SHARING' });
      const { queue, next } = qu.popNext(L.queue);
      if (!next) return reply({ error: 'EMPTY' });
      L.queue = queue;
      const now = Date.now();
      const r = applyAction(L.playback, { kind: 'set', status: 'playing', position: 0, videoId: next.videoId }, { userId: socket.user.userId, name: socket.user.name, now, lastToggleAt: 0 });
      if (r.accepted) {
        L.playback = r.state;
        io.to(code).emit('play:state', L.playback);
      }
      broadcastQueue();
      reply({ ok: true, videoId: next.videoId });
    });

    // One person at a time shares a tab/screen or a local video file. The room clock then counts seconds since the
    // share began, so reactions and the recap still have a timeline.
    on('share:start', ({ kind, label }, reply) => {
      if (!needRoom(reply)) return;
      const L = getLive(code);
      if (L.share && L.share.userId !== socket.user.userId) return reply({ error: 'SOMEONE_SHARING', by: L.share.name });
      const now = Date.now();
      L.share = { userId: socket.user.userId, name: socket.user.name, kind, label: label || null };
      L.playback = { videoId: 'screen-share', status: 'playing', position: 0, updatedAtServer: now, version: L.playback.version + 1, by: socket.user.userId, byName: socket.user.name };
      io.to(code).emit('share:state', L.share);
      io.to(code).emit('play:state', L.playback);
      reply({ ok: true });
    });

    on('share:stop', (_p, reply) => {
      if (!needRoom(reply)) return;
      reply({ ok: endShare(code) });
    });

    // Relay only to a member of the same room.
    on('rtc:signal', ({ to, type, payload, channel }, reply) => {
      if (!code) return reply({ error: 'NOT_IN_ROOM' });
      const target = registry.members(code).find((m) => m.userId === to);
      if (!target) return reply({ error: 'NOT_FOUND' });
      io.to(target.socketId).emit('rtc:signal', { from: socket.user.userId, type, payload, channel: channel || 'cam' });
      reply({ ok: true });
    });

    socket.on('disconnect', leave);
  });

  const closeAll = async () => {
    clearInterval(timer);
    await Promise.all([...live.keys()].map(flush));
    io.close();
  };
  return { io, closeAll };
}
