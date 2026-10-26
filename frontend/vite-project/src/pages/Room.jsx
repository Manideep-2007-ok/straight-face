import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { useRoom } from '../hooks/useRoom.js';
import { useWebRTC } from '../hooks/useWebRTC.js';
import Tile from '../components/Tile.jsx';
import DontLaugh from '../components/DontLaugh.jsx';
import { FloatingEmoji, FaceReactions, EMOJIS, useFloaters } from '../components/Reactions.jsx';
import SyncedPlayer from '../components/SyncedPlayer.jsx';
import { parseYouTubeId, fetchTitle } from '../lib/youtube.js';
import { visibleMessages } from '../lib/sync.js';
import '../styles/room.css';

const fmt = (s) => {
  const t = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

function Notice({ title, body }) {
  return (
    <main className="center-screen">
      <div className="glass card stack">
        <h1 style={{ fontSize: '1.75rem' }}>{title}</h1>
        <p className="muted">{body}</p>
        <Link to="/home" className="btn" style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>Back to your rooms</Link>
      </div>
    </main>
  );
}

export default function Room() {
  const { code } = useParams();
  const room = useRoom(code);
  const [started, setStarted] = useState(false); // "Join the party" click unlocks audio
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const [myPos, setMyPos] = useState(0);
  const [peek, setPeek] = useState(false);
  const chatEnd = useRef(null);
  const posRef = useRef(0);
  const [faceOn, setFaceOn] = useState(false);
  const floaters = useFloaters(room.socket);
  const rtc = useWebRTC({ socketRef: room.socket, me: room.me, members: room.members, enabled: started && room.status === 'joined' });

  const { shown, hidden } = visibleMessages(room.chat, myPos, room.playback?.videoId);
  const messages = peek ? room.chat : shown;

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  if (room.status === 'notfound') return <Notice title="Room not found" body="No room has that code. Check it and try again." />;
  if (room.status === 'full') return <Notice title="This room is full" body="Rooms hold up to 4 people. Ask the host to leave a seat, or make your own room." />;
  if (room.status === 'autherror') return <Notice title="You are signed out" body="Log in again to join this room." />;
  if (room.status === 'connecting') {
    return <main className="center-screen muted" role="status">{room.online ? 'Joining the room…' : 'Reconnecting…'}</main>;
  }
  if (room.status === 'offline') return <Notice title="Could not join" body="We could not reach the room. Check your connection and try again." />;

  if (!started) {
    return (
      <main className="center-screen">
        <div className="glass card stack">
          <h1 style={{ fontSize: '2rem' }}>{room.roomName}</h1>
          <p className="muted">
            {room.members.length} in the room: {room.members.map((m) => m.name).join(', ')}.
          </p>
          <button className="btn btn-primary" onClick={() => setStarted(true)}>Join the party</button>
          <p className="muted" style={{ fontSize: '0.875rem' }}>
            This click lets your browser play sound. You can catch up to the right second right after.
          </p>
        </div>
      </main>
    );
  }

  const pb = room.playback;
  const action = pb?.byName && pb.version > 0 ? `${pb.byName} ${pb.status === 'playing' ? 'played' : 'paused'}` : '';

  function loadVideo(e) {
    e.preventDefault();
    const id = parseYouTubeId(link);
    if (!id) return setLinkError('That does not look like a YouTube link. Paste the video address.');
    setLinkError('');
    room.setStatePlay('playing', 0, id);
    setLink('');
  }

  async function addToQueue() {
    const id = parseYouTubeId(link);
    if (!id) return setLinkError('That does not look like a YouTube link. Paste the video address.');
    setLinkError('');
    const title = await fetchTitle(id);
    const r = await room.emit('queue:add', { videoId: id, ...(title ? { title } : {}) });
    if (r?.error === 'ALREADY_QUEUED') return setLinkError('That video is already in the queue.');
    if (r?.error === 'QUEUE_FULL') return setLinkError('The queue is full (20 videos).');
    setLink('');
  }

  function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    room.sendChat(text.trim());
    setText('');
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the code is on screen */
    }
  }

  return (
    <div className="room" style={{ '--room-glow': room.level }}>
      {!room.online && <div className="banner" role="status">Reconnecting…</div>}
      <header className="room-top">
        <h1 style={{ fontSize: '1.25rem' }}>{room.roomName}</h1>
        <button className="chip mono" onClick={copyInvite} aria-label="Copy invite link">{copied ? 'Copied' : code}</button>
        <Link to={`/room/${code}/recap`} className="btn btn-ghost" style={{ marginLeft: 'auto', display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>Recaps</Link>
        <Link to="/home" className="btn btn-ghost" style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>Leave</Link>
      </header>

      <section className="stage">
        <div className="stage-wrap">
        <SyncedPlayer
          playback={pb}
          serverNow={room.serverNow}
          started={started}
          onSet={(status, pos) => room.setStatePlay(status, pos)}
          onSeek={room.seek}
          onPosition={(t) => {
            posRef.current = t;
            setMyPos(t);
          }}
          onEnded={() => room.emit('dl:stop')}
        />
        <FloatingEmoji items={floaters} />
        </div>

        <ul className="tiles" aria-label="People in the room">
          {room.members.map((m) => {
            const isMe = m.userId === room.me.userId;
            const rp = room.round.players?.find((p) => p.userId === m.userId);
            return (
              <Tile
                key={m.userId}
                name={m.name}
                isMe={isMe}
                stream={isMe ? rtc.localStream : rtc.remote[m.userId]?.stream}
                state={rtc.remote[m.userId]?.state}
                camOff={isMe && !rtc.camOn}
                micOff={isMe && !rtc.micOn}
                out={rp ? !rp.alive : false}
              />
            );
          })}
        </ul>

        <DontLaugh
          round={room.round}
          me={room.me}
          media={rtc.media}
          localStream={rtc.localStream}
          serverNow={room.serverNow}
          getPosition={() => posRef.current}
          emit={room.emit}
          hasVideo={!!pb?.videoId}
        />

        <div className="emoji-row row" role="group" aria-label="Send a reaction">
          {EMOJIS.map((e) => (
            <button key={e} className="btn emoji-btn" onClick={() => room.emit('react:emoji', { emoji: e })} aria-label={`Send ${e}`}>{e}</button>
          ))}
        </div>

        <div className="controls row" role="group" aria-label="Your camera and microphone">
          <button className="btn icon-btn" onClick={rtc.toggleMic} disabled={rtc.media !== 'live'} aria-label={rtc.micOn ? 'Mute microphone' : 'Unmute microphone'} aria-pressed={!rtc.micOn}>
            {rtc.micOn ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <button className="btn icon-btn" onClick={rtc.toggleCam} disabled={rtc.media !== 'live'} aria-label={rtc.camOn ? 'Turn camera off' : 'Turn camera on'} aria-pressed={!rtc.camOn}>
            {rtc.camOn ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
          <button className="btn" onClick={() => setFaceOn((v) => !v)} disabled={rtc.media !== 'live'} aria-pressed={faceOn}>
            Face reactions: {faceOn ? 'on' : 'off'}
          </button>
          <FaceReactions enabled={faceOn} paused={room.round.phase !== 'idle' && room.round.phase !== 'ended'} stream={rtc.localStream} emit={room.emit} getPosition={() => posRef.current} />
          {rtc.media === 'asking' && <span className="muted">Waiting for camera permission…</span>}
          {rtc.media === 'denied' && <span className="muted">Camera blocked. You are watching from the sidelines. Chat still works.</span>}
          {rtc.media === 'none' && <span className="muted">No camera found. You are watching from the sidelines.</span>}
        </div>
        {rtc.media === 'live' && <p className="muted privacy-note">Your camera is read in your browser. Only numbers (how much you are smiling) are shared, and only while face reactions or a game are on.</p>}
        <p className="muted action-line" aria-live="polite">{action}</p>

        <form className="row" onSubmit={loadVideo}>
          <label htmlFor="yt" className="sr-only">YouTube link</label>
          <input id="yt" className="grow" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a YouTube link" />
          <button className="btn">Play this video</button>
          <button type="button" className="btn btn-ghost" onClick={addToQueue}>Add to queue</button>
        </form>
        {linkError && <p className="error-text" role="alert">{linkError}</p>}

        <section className="queue" aria-label="Up next">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: '1.0625rem' }}>Up next</h2>
            {room.queue.length > 0 && <button className="btn btn-ghost" onClick={() => room.emit('queue:next')}>Play the top video</button>}
          </div>
          {room.queue.length === 0 && <p className="muted">Nothing queued. Add a video, then everyone votes for what plays next.</p>}
          <ul className="queue-list">
            {room.queue.map((q) => {
              const voted = q.voters.includes(room.me.userId);
              return (
                <li key={q.id}>
                  <span className="grow-text">{q.title} <span className="muted">added by {q.addedByName}</span></span>
                  <button className="chip" aria-pressed={voted} onClick={() => room.emit('queue:vote', { id: q.id })} aria-label={`${voted ? 'Remove your vote for' : 'Vote for'} ${q.title}`}>
                    {voted ? '▲ voted' : '△ vote'} · {q.votes}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

      </section>

      <aside className="chat glass" aria-label="Chat">
        <ul className="messages">
          {messages.length === 0 && <li className="muted">No messages yet. Say something.</li>}
          {messages.map((m, i) => (
            <li key={`${m.createdAt}-${i}`}>
              <span className="mono muted stamp">{m.t != null ? fmt(m.t) : '--:--'}</span>{' '}
              <strong>{m.name}</strong> <span>{m.text}</span>
            </li>
          ))}
          {hidden > 0 && !peek && (
            <li><button className="chip" onClick={() => setPeek(true)}>{hidden} message{hidden > 1 ? 's' : ''} from later. Tap to peek.</button></li>
          )}
          <li ref={chatEnd} />
        </ul>
        <form className="row chat-form" onSubmit={send}>
          <label htmlFor="msg" className="sr-only">Message</label>
          <input id="msg" className="grow" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Message" autoComplete="off" />
          <button className="btn btn-primary">Send</button>
        </form>
      </aside>
    </div>
  );
}
