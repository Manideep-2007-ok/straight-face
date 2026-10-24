# Straight Face

A watch party where your face plays the game.

Up to four friends watch the same YouTube video in sync, talk on voice and video, and chat. Anyone can play, pause or seek. Each person's browser reads their own face locally, and that powers a **Don't Laugh** game, floating **auto reactions**, and a **Reaction Radar** recap that shows the exact seconds the room cracked up.

- Live app: _add the Vercel URL after deploying_
- Demo video: _add the link after recording_

## Problem

Watch parties are a video plus a chat box. Nothing reacts to the people actually watching.

## Users

Friends and classmates who watch things together while apart.

## Words used in this README

- **WebRTC**: a browser feature that sends voice and video straight between two people, without going through our server.
- **Mesh**: every person connects directly to every other person. That is why a room is capped at 4.
- **TURN server**: a relay used only when two people's networks block a direct connection.
- **Socket.IO**: a library that keeps a live two-way connection between the browser and the server, used for chat and sync.
- **MediaPipe**: Google's pretrained face-tracking library. It runs in the browser.
- **Blendshape**: a number from 0 to 1 for one facial movement, such as "mouth smile left".

## Features

| Feature | Status |
|---|---|
| Sign up, log in, create room with a 6-letter code, join by code or link, max 4 | Built, tested live |
| Synced YouTube playback, anyone can control, late joiners catch up, drift correction | Built, tested live |
| Chat stamped with video time; hides later messages after a rewind | Built |
| Voice and video mesh, mic and camera toggles, speaker ring, no-camera fallback | Built, **not yet tested between two real devices** |
| Face reading (smile, surprise) with per-person calibration | Built, model and wasm load verified; **not yet tested on a live face** |
| Don't Laugh round: calibrate, 5 s countdown, live, winner | Server rules fully tested; UI built, **not yet tested with real faces** |
| Manual emoji and face-triggered emoji floating over the video | Built |
| Reaction Radar heat strip, peaks, awards, past parties, sample party | Built, tested with seeded data |
| Video queue with voting (most votes plays next) | Built, tested live |
| Custom-trained emotion model (Part B) | **Not part of this build** |
| Custom glass control bar | Not built. The player uses YouTube's own controls, and every play, pause and seek is still synced. |

## What is pretrained and what is trained

- Face reading uses **MediaPipe FaceLandmarker, a pretrained model from Google**. Nothing in it was trained by this project.
- The smile score is the mean of the two `mouthSmile` blendshapes. The surprise score is a scaled mean of `jawOpen`, `eyeWide` and `browInnerUp`.
- The "laugh" in Reaction Radar is a **smile score**, not an audio laugh detector.
- If a custom model is trained in Part B, it will be described in a Model card section here. Until then, there isn't one.

## Privacy

- No video, audio or image is recorded, stored, or sent to our server. The camera is read in your browser.
- Only numbers leave your browser, and only while face reactions are switched on or a game is running: a smile score, a surprise score, and a one-time "I'm out" event.
- Face reactions are off by default. People with the camera off can still watch and chat.
- Voice and video travel directly between browsers (WebRTC). If a direct link is blocked, a TURN relay forwards the encrypted stream.

## How playback sync works

1. The server holds the only truth: `{ videoId, status, position, updatedAtServer, version, by }`.
2. Everyone computes where the video should be: `position + (now - updatedAtServer)` while playing.
3. Clocks differ, so each client pings the server 5 times on join, keeps the reply with the lowest round trip, and stores `offset = serverTime - (sendTime + rtt/2)`.
4. Every 2 seconds the client compares its player with the expected position. Over 1.2 s off: seek. Between 0.3 and 1.2 s: run at 0.95x or 1.05x speed for 2 s. Smaller: do nothing.
5. When a remote update is applied, a 500 ms guard stops the YouTube event from echoing it back.
6. Two people pressing play or pause: last write wins, each user has a 700 ms cooldown on toggles, and the screen says who did it ("Riya paused").

Rules live in `backend/logic/playbackState.js` and are mirrored in `frontend/src/lib/sync.js`.

## How the Don't Laugh round works

1. **Calibrate**: each player holds a neutral face for 3 s. Threshold = max(0.35, mean + 2 standard deviations of their smile + 0.25). This stops people with naturally upturned mouths from losing at once.
2. **Countdown**: 5 s, started by anyone once at least 2 people are calibrated. People who did not calibrate become spectators.
3. **Live**: the video starts from 0. Each browser smooths its smile score and, when it stays above threshold for 3 frames (about 0.4 s), sends one "out" event. The server checks the round is live, that the player is still in, and that the time is within 5 s of the real playback position.
4. **Result**: last straight face wins. If the video ends with 2 or more still in, they share the title "Poker faces".

Known limit: it is a party game, so each browser reports its own face and cheating is possible. Covering the camera makes the face "not found", which counts as watching from the sidelines, not as winning.

## Architecture

```
Browser A  <--- WebRTC voice/video (direct, or via TURN) --->  Browser B
   |                                                              |
   +---------- Socket.IO (cookie-authenticated) -----------------+
                               |
                     Express + Socket.IO server
                     |  room registry (in memory)
                     |  playback / chat / game logic (pure functions)
                               |
                          MongoDB Atlas
          users, rooms, parties, chat, reactions, game rounds
```

- Backend: a single Node process. Live room state is in memory for speed. MongoDB stores users, rooms, parties, chat, reactions and rounds. Chat and reactions are saved in batches every 3 s (or 50 items), and flushed on shutdown.
- Every socket payload is validated with zod, rate limited (30 events/s, chat 5 burst), and size limited to 100 KB. Signalling messages are only relayed to members of the same room.

## Measured numbers

Measured on this machine against a local server, so they show the code is not the bottleneck, not what users will experience.

| Check | Result |
|---|---|
| Load test, 4 clients, 20 events/s for 30 s (`scripts/loadtest.js`) | 596 events, 0 rejected, fan-out p50 1 ms, p95 1 ms, all 4 clients stayed connected |
| `GET /health` locally, 60 requests | p50 1.3 ms, p95 1.9 ms |
| Live end-to-end check (`scripts/e2e.mjs`) | 36 checks pass: auth, room cap, sync, cooldown, chat, late join, signalling relay, full game round, queue and voting |

_To fill in after deploying: the same load test and REST latency against the Render URL, and a note on cold start (about 50 s on the free tier)._

## Tests

```bash
cd backend && npm test             # unit tests (logic, schemas, registry)
cd backend && node scripts/e2e.mjs # live check, needs the server running and Atlas
cd frontend/vite-project && npm test
```

## Local setup

Needs Node 20+ and a MongoDB Atlas connection string.

```bash
cd backend
cp .env.example .env     # fill in dbURL and JWT_SECRET
npm install
npm run dev              # http://localhost:4000

cd ../frontend/vite-project
cp .env.example .env
npm install
npm run dev              # http://localhost:5173
```

Optional: `npm run seed` in `backend/` creates 3 demo users (password `demo1234`), room `PARTY2` and one sample party. Its data is synthetic and labelled "sample" in the app. `npm run seed -- --clean` also removes throwaway test users.

## Environment variables

| Variable | Where | Meaning |
|---|---|---|
| `PORT` | backend | Port to listen on (Render sets it) |
| `dbURL` | backend | MongoDB Atlas connection string |
| `DB_NAME` | backend | Database name, default `straightface` |
| `JWT_SECRET` | backend | Secret for login tokens, 16+ characters |
| `CLIENT_URL` | backend | Frontend URL, no trailing slash. Used for CORS and cookies |
| `NODE_ENV` | backend | `production` on Render. Turns on secure cross-site cookies |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | backend | Optional TURN relay. Served to logged-in users by `GET /api/rtc/ice` so they never sit in the frontend bundle |
| `VITE_API_URL` | frontend | Backend URL |
| `VITE_EMOTION_ENGINE` | frontend | `mediapipe` (default) |

## Deployment

1. **Atlas**: free cluster, a database user, network access `0.0.0.0/0`.
2. **Render** (backend): web service, root `backend`, build `npm install`, start `npm start`, health check `/health`. Set `dbURL`, `JWT_SECRET`, `CLIENT_URL` (the Vercel URL), `NODE_ENV=production`, and the TURN variables.
3. **Vercel** (frontend): root `frontend/vite-project`, framework Vite, env `VITE_API_URL` set to the Render URL. `vercel.json` already contains the single-page-app rewrite.
4. Open the live URL on a phone using mobile data to prove the TURN path works.

The MediaPipe model and wasm files are served from `frontend/vite-project/public/mediapipe/` so the demo does not depend on a CDN.

## Known limits

- Safari may block the cross-site login cookie. Test on Chrome and Firefox.
- Free-tier hosting has a cold start of about 50 s. Open the site once before a demo.
- Mesh calls are capped at 4 people.
- The game is client-reported (see above).
- Live room state is in memory, so a server restart ends live parties. Saved chat, reactions and rounds are kept. Scaling to several servers would need the Socket.IO Redis adapter.
- Without a TURN relay, calls can fail between strict networks.

## Credits

- YouTube IFrame Player API
- MediaPipe Tasks Vision (FaceLandmarker model `face_landmarker.task`, from Google's MediaPipe model storage)
- Lucide icons
- Fonts: Bricolage Grotesque, Instrument Sans, JetBrains Mono (Google Fonts)
