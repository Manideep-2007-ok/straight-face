import crypto from 'node:crypto';

// No 0/O/1/I/L so codes are easy to read aloud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRoomCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export const ROOM_CODE_RE = /^[A-HJKMNP-Z2-9]{6}$/;
