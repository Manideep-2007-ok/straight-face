import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { currentSid } from '../state/sessionBus.js';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  next();
}

export const ok = (req, res, data, status = 200) =>
  res.status(status).json({ data, meta: { requestId: req.id } });

// Validates { body, query, params } with zod schemas; replaces them with parsed values.
export const validate = (schemas) => (req, res, next) => {
  for (const part of ['body', 'query', 'params']) {
    if (!schemas[part]) continue;
    const r = schemas[part].safeParse(req[part]);
    if (!r.success) {
      // Use the first specific message so the person sees what to fix (e.g. "Your password must be at least 8 characters.").
      const first = r.error.issues.find((i) => i.message && !/^Invalid input|^Unrecognized key/i.test(i.message));
      return next(new HttpError(400, 'VALIDATION', first?.message || 'Some fields are not valid.', r.error.flatten()));
    }
    // Express 5 makes req.query a getter, so define the parsed value instead of assigning.
    Object.defineProperty(req, part, { value: r.data, writable: true, configurable: true, enumerable: true });
  }
  next();
};

export function signToken(userId, secret, sid) {
  return jwt.sign({ sub: String(userId), sid }, secret, { expiresIn: '7d' });
}

// Returns { userId, sid } or null.
export function verifyToken(token, secret) {
  try {
    const p = jwt.verify(token, secret);
    return p.sid ? { userId: p.sub, sid: p.sid } : null; // tokens without a session id are from before one-login-per-account
  } catch {
    return null;
  }
}

// True when this token belongs to the account's newest login.
export async function sessionIsCurrent({ userId, sid }) {
  return (await currentSid(userId)) === sid;
}

export const authRequired = (config) => async (req, res, next) => {
  const t = verifyToken(req.cookies?.token, config.JWT_SECRET);
  if (!t) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please log in.'));
  if (!(await sessionIsCurrent(t))) {
    res.clearCookie('token', { httpOnly: true, sameSite: config.isProd ? 'none' : 'lax', secure: config.isProd });
    return next(new HttpError(401, 'SESSION_REPLACED', 'You were signed out because this account was opened on another device.'));
  }
  req.userId = t.userId;
  next();
};

const limiterMessage = (req) => ({
  error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait a bit and try again.' },
  meta: { requestId: req.id },
});

// Only FAILED attempts count (wrong password, bad input), so guessing is still capped at 10 per 15 minutes per network
// but a classroom logging in successfully from one Wi-Fi is not locked out.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 10 : 200,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json(limiterMessage(req)),
});

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json(limiterMessage(req)),
});

export const notFound = (req, res, next) =>
  next(new HttpError(404, 'NOT_FOUND', 'That route does not exist.'));

export const errorHandler = (isProd) => (err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(`[${req.id}]`, err);
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL',
      message: status >= 500 && isProd ? 'Something went wrong on our side.' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
    meta: { requestId: req.id },
  });
};
