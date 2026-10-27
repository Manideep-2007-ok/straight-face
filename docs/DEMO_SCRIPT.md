# Demo video script (about 4 minutes)

Record a screen capture of the laptop with the phone shown beside it (or a second window). Speak plainly; the numbers in
brackets are rough timings.

## Before you press record (do all of these)

1. **Wake the servers.** Open https://straight-face-web.onrender.com about two minutes earlier and let it load. The free servers
   sleep when idle and the first visit can take up to a minute.
2. **Put both devices on the same network** (a phone hotspot is safest) and hard-reload both. The corner label should read the
   same `v …` on both.
3. **Use two different accounts**, for example `riya@demo.test` on the laptop and `arjun@demo.test` on the phone, password
   `demo1234`. The same account on two devices signs the first one out.
4. **Good light on your face** for the game, camera at eye level, face filling a good part of the picture.
5. Have a short **YouTube link** ready (under 2 minutes, one that allows embedding) and a small **MP3 or MP4** file on the laptop.
6. Close other tabs and silence notifications.

## Script

**0:00 The problem (15 s).** "Watch parties today are a video and a chat box. Nothing reacts to the people actually watching.
Straight Face is a watch party where your face plays the game."

**0:15 Sign up and make a room (25 s).** Show the landing page. Log in as Riya. Create a room called "Demo night". Point at the
6-letter code and the "Copy invite link" button.

**0:40 Join from a second device (20 s).** On the phone, log in as Arjun, type the code, press **Join the party**. Show both
people's tiles appear on both screens with live video. Say: "Calls go straight between the two devices. If a network blocks
that, they fall back to a relay server."

**1:00 Synced video (30 s).** Paste the YouTube link and press **Play this video**. It starts on both. Pause on the phone: it
pauses on the laptop and says who paused it. Seek on the laptop: the phone jumps. Say: "Anyone can control it, and the server
keeps everyone within about a second of each other."

**1:30 Chat and reactions (15 s).** Send a chat message (note the video time stamp). Tap two emoji: they float up on both
screens.

**1:45 Queue and voting (10 s).** Add two videos to the queue, vote on the phone, press **Play the top video**.

**1:55 Share anything (20 s).** Press **Play a local video or song**, pick the MP3: the other device hears it and shows a "now
playing" card. Stop. Say: "Any website works too, with **Share screen or tab**."

**2:15 Don't Laugh (60 s).** Load a funny short video. Press **Start Don't Laugh**. Both people hold a neutral face for the 3
second calibration ("this sets what calm looks like for you, so people who naturally smile do not lose at once"). Press
**Start countdown**. During the video, one person smiles: they get the red OUT stamp, the other wins. Say: "The camera is read
in the browser. Only a smile score leaves the device. Nothing is recorded or uploaded."

**3:15 Recap (30 s).** Open **Recaps**. Show the heat strip of when the room laughed, the peak times, the awards, and the
round result. Open the "Sample party" tab to show a fuller one.

**3:45 How it works (30 s).** Show the README architecture diagram. Say: "React and Vite on the front end, Node, Express and
Socket.IO on the back end, MongoDB Atlas for the data. Playback sync uses a server clock and drift correction. Calls are
WebRTC. Face reading is MediaPipe in the browser, and I also trained a small CNN on FER2013 that reached 70.5 percent on its
test set, which is optional. Everything is deployed on Render, with tests for the logic, the API, and real browsers."

**4:00 End.**

## If something goes wrong while recording

- **"Connecting…" on a tile:** press **Retry video** on that tile, or both reload and rejoin.
- **YouTube says it cannot play:** pick another video; the app shows a clear message.
- **The game says it cannot see your face:** move into the light and face the camera; the face reader needs a clear view.
- **A page is slow the first time:** the free server is waking up. Wait for the "Waking up the server…" message to clear.

## Text for the form: "Explain the Problem Statement and Technologies Used"

> Straight Face is a watch party where your face plays the game. Up to four friends watch the same YouTube video in sync
> (anyone can play, pause or seek), talk on voice and video, chat, and share a screen, tab or local video or MP3. Each browser
> reads its own face locally with MediaPipe (nothing is recorded or uploaded; only a smile score is shared) to power a "Don't
> Laugh" game, auto emoji reactions, and a Reaction Radar recap that shows the exact seconds the room cracked up, plus awards.
> The problem: watch parties are just a video and a chat box, and nothing reacts to the people watching.
> Tech: React + Vite, Node + Express, Socket.IO, MongoDB Atlas (Mongoose), WebRTC mesh with a TURN relay fallback, MediaPipe
> Face Landmarker, a small CNN trained on FER2013 (PyTorch, exported to plain JavaScript), zod validation, JWT cookie auth,
> deployed on Render. Tested with node:test unit tests, live socket checks, and Playwright browser tests.
