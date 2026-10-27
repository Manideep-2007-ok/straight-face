import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import crypto from 'node:crypto';
import { User } from '../models/index.js';
import { startSession } from '../state/sessionBus.js';
import { HttpError, ok, validate, signToken, authRequired, authLimiter } from '../middleware/index.js';

const signupBody = z
  .object({
    name: z.string().trim().min(1, 'Enter your name.').max(40, 'Your name can be at most 40 characters.'),
    email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
    password: z.string().min(8, 'Your password must be at least 8 characters.').max(100, 'Your password can be at most 100 characters.'),
  })
  .strict();

const loginBody = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
    password: z.string().min(1, 'Enter your password.').max(100),
  })
  .strict();

const publicUser = (u) => ({ id: String(u._id), name: u.name, email: u.email });

export default function authRoutes(config) {
  const r = Router();
  const cookieOpts = {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: config.isProd ? 'none' : 'lax',
    secure: config.isProd,
  };

  r.post('/signup', authLimiter, validate({ body: signupBody }), async (req, res, next) => {
    try {
      const { name, email, password } = req.body;
      if (await User.exists({ email })) {
        throw new HttpError(409, 'EMAIL_TAKEN', 'An account with that email already exists.');
      }
      const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 10) });
      const sid = crypto.randomUUID();
      await startSession(user._id, sid);
      res.cookie('token', signToken(user._id, config.JWT_SECRET, sid), cookieOpts);
      ok(req, res, publicUser(user), 201);
    } catch (e) {
      next(e);
    }
  });

  r.post('/login', authLimiter, validate({ body: loginBody }), async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email });
      const good = user && (await bcrypt.compare(password, user.passwordHash));
      if (!good) throw new HttpError(401, 'BAD_LOGIN', 'Wrong email or password');
      const sid = crypto.randomUUID();
      await startSession(user._id, sid); // signs out every other device
      res.cookie('token', signToken(user._id, config.JWT_SECRET, sid), cookieOpts);
      ok(req, res, publicUser(user));
    } catch (e) {
      next(e);
    }
  });

  r.post('/logout', (req, res) => {
    res.clearCookie('token', { ...cookieOpts, maxAge: undefined });
    ok(req, res, { loggedOut: true });
  });

  r.get('/me', authRequired(config), async (req, res, next) => {
    try {
      const user = await User.findById(req.userId);
      if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please log in.');
      ok(req, res, publicUser(user));
    } catch (e) {
      next(e);
    }
  });

  return r;
}
