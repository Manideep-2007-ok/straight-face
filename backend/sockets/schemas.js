import { z } from 'zod';
import { YT_ID_RE } from '../logic/youtube.js';
import { ROOM_CODE_RE } from '../utils/roomCode.js';

const pos = z.number().finite().min(0).max(60 * 60 * 24);
const videoId = z.string().regex(YT_ID_RE);

export const schemas = {
  'room:join': z.object({ code: z.string().trim().toUpperCase().regex(ROOM_CODE_RE) }).strict(),
  'room:leave': z.any(),
  'clock:ping': z.object({ c: z.number().finite() }).strict(),
  'play:set': z
    .object({
      videoId: videoId.optional(),
      status: z.enum(['playing', 'paused']),
      position: pos.optional(),
      baseVersion: z.number().int().optional(),
    })
    .strict(),
  'play:seek': z.object({ position: pos, baseVersion: z.number().int().optional() }).strict(),
  'dl:start': z.object({ smileThreshold: z.number().min(0).max(1).optional() }).strict(),
  'dl:calibrated': z.object({ threshold: z.number().min(0).max(1) }).strict(),
  'dl:begin': z.any(),
  'dl:out': z.object({ t: z.number().finite().min(0), peak: z.number().min(0).max(1) }).strict(),
  'dl:stop': z.any(),
  'dl:cancel': z.any(),
  'react:emoji': z.object({ emoji: z.enum(['😂', '😄', '😮', '❤️', '👏', '🔥', '😱', '💀']), auto: z.boolean().optional(), strength: z.number().min(0).max(1).optional() }).strict(),
  'radar:sample': z.object({ t: z.number().min(0).max(86400), smile: z.number().min(0).max(1), surprise: z.number().min(0).max(1) }).strict(),
  'queue:add': z.object({ videoId: videoId, title: z.string().trim().max(120).optional() }).strict(),
  'queue:vote': z.object({ id: z.string().min(1).max(40) }).strict(),
  'queue:next': z.any(),
  'chat:send': z.object({ text: z.string().trim().min(1).max(500) }).strict(),
  'rtc:signal': z
    .object({ to: z.string().min(1).max(40), type: z.enum(['offer', 'answer', 'ice', 'reset']), payload: z.any(), channel: z.enum(['cam', 'screen']).optional() })
    .strict(),
  'share:start': z.object({ kind: z.enum(['screen', 'file']), label: z.string().trim().max(120).optional() }).strict(),
  'share:stop': z.any(),
};
