import { Router } from 'express';
import { z } from 'zod';
import { Room } from '../models/index.js';
import { HttpError, ok, validate, authRequired } from '../middleware/index.js';
import { generateRoomCode, ROOM_CODE_RE } from '../utils/roomCode.js';

const createBody = z.object({ name: z.string().trim().min(1).max(60) }).strict();
const codeParams = z.object({ code: z.string().trim().toUpperCase().regex(ROOM_CODE_RE) });

export default function roomRoutes(config, registry) {
  const r = Router();
  const auth = authRequired(config);

  r.post('/', auth, validate({ body: createBody }), async (req, res, next) => {
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const room = await Room.create({
            code: generateRoomCode(),
            name: req.body.name,
            hostId: req.userId,
            memberIds: [req.userId],
          });
          return ok(req, res, { code: room.code, name: room.name, maxMembers: room.maxMembers }, 201);
        } catch (e) {
          if (e.code !== 11000) throw e; // duplicate code: try another
        }
      }
      throw new HttpError(500, 'CODE_COLLISION', 'Could not make a room code. Try again.');
    } catch (e) {
      next(e);
    }
  });

  // Must be declared before '/:code' so "mine" is not read as a code.
  r.get('/mine', auth, async (req, res, next) => {
    try {
      const rooms = await Room.find({ memberIds: req.userId }).sort({ lastActiveAt: -1 }).limit(50);
      ok(
        req,
        res,
        rooms.map((x) => ({ code: x.code, name: x.name, lastActiveAt: x.lastActiveAt })),
      );
    } catch (e) {
      next(e);
    }
  });

  r.get('/:code', validate({ params: codeParams }), async (req, res, next) => {
    try {
      const room = await Room.findOne({ code: req.params.code });
      if (!room) throw new HttpError(404, 'NOT_FOUND', 'No room with that code.');
      ok(req, res, {
        code: room.code,
        name: room.name,
        memberCount: registry ? registry.memberCount(room.code) : 0,
        maxMembers: room.maxMembers,
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
