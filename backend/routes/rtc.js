import { Router } from 'express';
import { ok, authRequired } from '../middleware/index.js';

// ICE servers are served from here so TURN credentials never sit in the frontend bundle.
export function buildIceServers(config) {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (config.TURN_URL && config.TURN_USERNAME && config.TURN_CREDENTIAL) {
    servers.push({
      urls: config.TURN_URL.split(',').map((u) => u.trim()).filter(Boolean),
      username: config.TURN_USERNAME,
      credential: config.TURN_CREDENTIAL,
    });
  }
  return servers;
}

export default function rtcRoutes(config) {
  const r = Router();
  r.get('/ice', authRequired(config), (req, res) => {
    const iceServers = buildIceServers(config);
    ok(req, res, { iceServers, hasTurn: iceServers.length > 1 });
  });
  return r;
}
