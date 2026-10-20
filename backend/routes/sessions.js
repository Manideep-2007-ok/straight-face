import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Room, PartySession, ReactionEvent, GameRound, ChatMessage } from '../models/index.js';
import { HttpError, ok, validate, authRequired } from '../middleware/index.js';
import { ROOM_CODE_RE } from '../utils/roomCode.js';
import { bucketHeat, topPeaks } from '../logic/heat.js';
import { computeAwards } from '../logic/awards.js';

const listQuery = z.object({ code: z.string().trim().toUpperCase().regex(ROOM_CODE_RE) });
const idParams = z.object({ id: z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id') });

export default function sessionRoutes(config) {
  const r = Router();
  const auth = authRequired(config);

  async function requireMember(req, roomId) {
    const room = await Room.findById(roomId).lean();
    if (!room || !room.memberIds.some((m) => String(m) === req.userId)) {
      throw new HttpError(403, 'FORBIDDEN', 'You are not a member of this room.');
    }
    return room;
  }

  r.get('/', auth, validate({ query: listQuery }), async (req, res, next) => {
    try {
      const room = await Room.findOne({ code: req.query.code }).lean();
      if (!room) throw new HttpError(404, 'NOT_FOUND', 'No room with that code.');
      await requireMember(req, room._id);
      const sessions = await PartySession.find({ roomId: room._id }).sort({ startedAt: -1 }).limit(20).lean();
      ok(req, res, sessions.map((s) => ({
        id: String(s._id), startedAt: s.startedAt, endedAt: s.endedAt, participants: s.participants.map((p) => p.name), sample: !!s.sample,
      })));
    } catch (e) {
      next(e);
    }
  });

  r.get('/:id/recap', auth, validate({ params: idParams }), async (req, res, next) => {
    try {
      const session = await PartySession.findById(req.params.id).lean();
      if (!session) throw new HttpError(404, 'NOT_FOUND', 'No party with that id.');
      await requireMember(req, session.roomId);

      const [events, rounds, chat] = await Promise.all([
        ReactionEvent.find({ sessionId: session._id }).lean(),
        GameRound.find({ sessionId: session._id }).sort({ startedAt: 1 }).lean(),
        ChatMessage.find({ sessionId: session._id }).sort({ createdAt: 1 }).limit(500).lean(),
      ]);

      // One heat strip per video watched in this party.
      const videoIds = [...new Set([...events.map((e) => e.videoId), ...chat.map((c) => c.videoId)].filter(Boolean))];
      const maxT = (vid) => Math.max(60, ...events.filter((e) => e.videoId === vid).map((e) => e.t + 1), ...chat.filter((c) => c.videoId === vid).map((c) => Math.ceil(c.t || 0) + 1));
      const heat = videoIds.map((videoId) => {
        const length = Math.min(maxT(videoId), 6 * 3600);
        const strip = bucketHeat(events.filter((e) => e.videoId === videoId), session.participants.length, length);
        return { videoId, length, heat: strip.map((x) => Math.round(x * 1000) / 1000), peaks: topPeaks(strip) };
      });

      const names = Object.fromEntries(session.participants.map((p) => [String(p.userId), p.name]));
      const awards = computeAwards({ rounds, events, names });

      // Chat moments: the busiest 10-second windows.
      const buckets = {};
      for (const c of chat) {
        if (c.t == null) continue;
        const k = `${c.videoId}|${Math.floor(c.t / 10) * 10}`;
        (buckets[k] ||= []).push(c);
      }
      const chatMoments = Object.entries(buckets).sort((a, b) => b[1].length - a[1].length).slice(0, 3)
        .map(([k, msgs]) => ({ videoId: k.split('|')[0], t: Number(k.split('|')[1]), count: msgs.length, sample: msgs[0].text }));

      ok(req, res, {
        id: String(session._id),
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        sample: !!session.sample,
        participants: session.participants.map((p) => p.name),
        heat,
        awards,
        rounds: rounds.map((x) => ({
          videoId: x.videoId, startedAt: x.startedAt,
          winners: x.winners.map((w) => names[String(w)] || 'Someone'),
          outcomes: x.outcomes.map((o) => ({ name: o.name, outAtT: o.outAtT })),
        })),
        chatMoments,
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
