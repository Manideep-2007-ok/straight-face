import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// Screen / tab / local-file sharing. One person shares at a time. The sharer opens a SEPARATE peer connection to
// each other person (channel "screen"), always as the offerer, so it never collides with the camera calls.
//
//   share  = who is sharing right now, from the server: { userId, name, kind, label } or null
//   remoteStream = what we receive when someone else shares
//   localStream  = what we send when we share
const MAX_BITRATE = 2_500_000;

export function useShare({ socketRef, me, members, share, emit }) {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [error, setError] = useState('');
  const sending = useRef(new Map()); // userId -> { pc, pending: [] }   (when I share)
  const receiving = useRef(null); //  { pc, pending: [] }              (when someone else shares)
  const localRef = useRef(null);
  const iceRef = useRef(null);
  const chain = useRef(Promise.resolve());

  const send = useCallback((to, type, payload) => socketRef.current?.emit('rtc:signal', { to, type, payload, channel: 'screen' }), [socketRef]);

  const iceServers = useCallback(async () => {
    if (!iceRef.current) iceRef.current = await api.ice().catch(() => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }));
    return iceRef.current.iceServers;
  }, []);

  const closeSending = useCallback(() => {
    sending.current.forEach((p) => p.pc?.close());
    sending.current.clear();
  }, []);
  const closeReceiving = useCallback(() => {
    receiving.current?.pc.close();
    receiving.current = null;
    setRemoteStream(null);
  }, []);

  // ---- sharer side: connect to one person
  const connectTo = useCallback(
    async (id) => {
      const stream = localRef.current;
      if (!stream || sending.current.has(id)) return;
      // Reserve the slot BEFORE awaiting anything, or two callers can both pass the check above and send two offers.
      const entry = { pc: null, pending: [] };
      sending.current.set(id, entry);
      const pc = new RTCPeerConnection({ iceServers: await iceServers() });
      entry.pc = pc;
      if (sending.current.get(id) !== entry || localRef.current !== stream) {
        pc.close(); // sharing stopped, or this person left, while we were setting up
        return;
      }
      pc.onicecandidate = ({ candidate }) => candidate && send(id, 'ice', candidate);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      // cap the video bitrate so four people can share over a normal home upload
      pc.getSenders().forEach((snd) => {
        if (snd.track?.kind !== 'video') return;
        const params = snd.getParameters();
        params.encodings = params.encodings?.length ? params.encodings : [{}];
        params.encodings[0].maxBitrate = MAX_BITRATE;
        snd.setParameters(params).catch(() => {});
      });
      await pc.setLocalDescription(await pc.createOffer());
      send(id, 'offer', pc.localDescription);
    },
    [iceServers, send],
  );

  const stopShare = useCallback(
    async (tellServer = true) => {
      const s = localRef.current;
      localRef.current = null;
      s?.getTracks().forEach((t) => t.stop());
      closeSending();
      setLocalStream(null);
      if (tellServer) await emit('share:stop');
    },
    [closeSending, emit],
  );

  // Start sharing a stream I already have (from getDisplayMedia or a media element).
  const startShare = useCallback(
    async (kind, stream, label) => {
      setError('');
      const r = await emit('share:start', { kind, ...(label ? { label } : {}) });
      if (r?.error) {
        stream.getTracks().forEach((t) => t.stop());
        setError(r.error === 'SOMEONE_SHARING' ? `${r.by} is already sharing. Wait until they stop.` : 'Could not start sharing. Try again.');
        return false;
      }
      localRef.current = stream;
      setLocalStream(stream);
      // The browser's own "Stop sharing" button (or the file ending) ends the tracks.
      stream.getTracks().forEach((t) => t.addEventListener('ended', () => localRef.current === stream && stopShare(true)));
      members.filter((m) => m.userId !== me.userId).forEach((m) => connectTo(m.userId));
      return true;
    },
    [connectTo, emit, me, members, stopShare],
  );

  const shareScreen = useCallback(async () => {
    setError('');
    if (!navigator.mediaDevices?.getDisplayMedia) return setError('This browser cannot share a screen. Try Chrome or Edge on a computer.');
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
    } catch (e) {
      if (e.name !== 'NotAllowedError') setError('Could not start screen sharing.');
      return false; // cancelled
    }
    return startShare('screen', stream);
  }, [startShare]);

  // When I share, also connect to anyone who arrives later; drop anyone who left.
  useEffect(() => {
    if (!localRef.current || !me) return;
    const ids = new Set(members.filter((m) => m.userId !== me.userId).map((m) => m.userId));
    ids.forEach((id) => connectTo(id));
    sending.current.forEach((p, id) => {
      if (!ids.has(id)) {
        p.pc?.close();
        sending.current.delete(id);
      }
    });
  }, [members, me, connectTo, localStream]);

  // ---- receiving
  const handle = useCallback(
    async ({ from, type, payload }) => {
      try {
        if (type === 'offer') {
          closeReceiving();
          const pc = new RTCPeerConnection({ iceServers: await iceServers() });
          const entry = { pc, pending: [], from };
          receiving.current = entry;
          pc.onicecandidate = ({ candidate }) => candidate && send(from, 'ice', candidate);
          pc.ontrack = ({ streams }) => streams[0] && setRemoteStream(streams[0]);
          await pc.setRemoteDescription(payload);
          for (const c of entry.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
          await pc.setLocalDescription(await pc.createAnswer());
          send(from, 'answer', pc.localDescription);
        } else if (type === 'answer') {
          const e = sending.current.get(from);
          if (!e) return;
          if (!e.pc) return;
          await e.pc.setRemoteDescription(payload);
          for (const c of e.pending.splice(0)) await e.pc.addIceCandidate(c).catch(() => {});
        } else if (type === 'ice') {
          const e = sending.current.get(from) || (receiving.current?.from === from ? receiving.current : null);
          if (!e || !e.pc) return;
          if (!e.pc.remoteDescription) e.pending.push(payload);
          else await e.pc.addIceCandidate(payload).catch(() => {});
        }
      } catch (e) {
        console.warn('share signalling error', e);
      }
    },
    [closeReceiving, iceServers, send],
  );

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !me) return undefined;
    const onSignal = (m) => {
      if (m.channel !== 'screen') return;
      chain.current = chain.current.then(() => handle(m)).catch(() => {});
    };
    socket.on('rtc:signal', onSignal);
    return () => socket.off('rtc:signal', onSignal);
  }, [socketRef, me, handle]);

  // The server says nobody is sharing any more: tidy up whatever side I was on.
  useEffect(() => {
    if (share) return;
    if (localRef.current) stopShare(false);
    closeReceiving();
  }, [share, stopShare, closeReceiving]);

  // Leaving the page ends my share.
  useEffect(
    () => () => {
      localRef.current?.getTracks().forEach((t) => t.stop());
      closeSending();
      receiving.current?.pc.close();
    },
    [closeSending],
  );

  return { localStream, remoteStream, error, setError, shareScreen, startShare, stopShare, iAmSharing: !!share && share.userId === me?.userId };
}
