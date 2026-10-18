import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

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
      return next(new HttpError(400, 'VALIDATION', 'Some fields are not valid.', r.error.flatten()));
    }
    // Express 5 makes req.query a getter, so define the parsed value instead of assigning.
    Object.defineProperty(req, part, { value: r.data, writable: true, configurable: true, enumerable: true });
  }
  next();
};

export function signToken(userId, secret) {
  return jwt.sign({ sub: String(userId) }, secret, { expiresIn: '7d' });
}

export function verifyToken(token, secret) {
  try {
    return jwt.verify(token, secret).sub;
  } catch {
    return null;
  }
}

export const authRequired = (config) => (req, res, next) => {
  const userId = verifyToken(req.cookies?.token, config.JWT_SECRET);
  if (!userId) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please log in.'));
  req.userId = userId;
  next();
};

const limiterMessage = (req) => ({
  error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait a bit and try again.' },
  meta: { requestId: req.id },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 10 : 200,
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
