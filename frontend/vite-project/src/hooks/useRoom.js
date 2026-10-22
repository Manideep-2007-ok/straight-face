import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from '../lib/api.js';
import { computeOffset } from '../lib/sync.js';

// Connects to the room, estimates the clock offset, and exposes shared state.
// status: connecting | joined | full | notfound | autherror | offline
export function useRoom(code) {
  const socketRef = useRef(null);
  const offsetRef = useRef(0);
  const [status, setStatus] = useState('connecting');
  const [online, setOnline] = useState(true);
  const [me, setMe] = useState(null);
  const [roomName, setRoomName] = useState('');
  const [playback, setPlayback] = useState(null);
  const [members, setMembers] = useState([]);
  const [chat, setChat] = useState([]);
  const [level, setLevel] = useState(0);
  const [round, setRound] = useState({ phase: 'idle', players: [], winners: [] });

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  useEffect(() => {
    const socket = io(API_URL, { withCredentials: true, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    async function measureClock() {
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const c0 = Date.now();
        // eslint-disable-next-line no-await-in-loop
        const r = await socket.timeout(3000).emitWithAck('clock:ping', { c: c0 }).catch(() => null);
        if (r?.s) samples.push({ c0, s: r.s, c1: Date.now() });
      }
      offsetRef.current = computeOffset(samples);
    }

    async function join() {
      await measureClock();
      const r = await socket.timeout(5000).emitWithAck('room:join', { code }).catch(() => ({ error: 'TIMEOUT' }));
      if (r.error === 'ROOM_FULL') return setStatus('full');
      if (r.error === 'NOT_FOUND') return setStatus('notfound');
      if (r.error) return setStatus('offline');
      setMe(r.me);
      setRoomName(r.room.name);
      setPlayback(r.state);
      setMembers(r.members);
      setChat(r.chat);
      if (r.round) setRound(r.round);
      setStatus('joined');
    }

    socket.on('connect', () => {
      setOnline(true);
      join();
    });
    socket.on('disconnect', () => setOnline(false));
    socket.on('connect_error', (e) => {
      if (e.message === 'auth_error') setStatus('autherror');
      else setOnline(false);
    });
    socket.on('room:members', setMembers);
    socket.on('play:state', setPlayback);
    socket.on('dl:state', setRound);
    socket.on('radar:live', (r) => setLevel(r.level));
    socket.on('chat:new', (m) => setChat((c) => [...c.slice(-199), m]));

    return () => {
      socket.emit('room:leave');
      socket.disconnect();
    };
  }, [code]);

  const emit = useCallback(
    (event, payload) => socketRef.current?.timeout(4000).emitWithAck(event, payload).catch(() => ({ error: 'TIMEOUT' })),
    [],
  );

  return {
    socket: socketRef,
    status,
    online,
    me,
    roomName,
    playback,
    members,
    chat,
    round,
    level,
    emit,
    serverNow,
    setStatePlay: (status, position, videoId) => emit('play:set', { status, position, ...(videoId ? { videoId } : {}) }),
    seek: (position) => emit('play:seek', { position }),
    sendChat: (text) => emit('chat:send', { text }),
  };
}
