import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api.js';

// Full-mesh WebRTC using "perfect negotiation" so two people joining at once cannot deadlock.
// media: 'idle' | 'asking' | 'live' | 'denied' | 'none'   (denied/none = watch + chat only)
export function useWebRTC({ socketRef, me, members, enabled }) {
  const [media, setMedia] = useState('idle');
  const [localStream, setLocalStream] = useState(null);
  const [remote, setRemote] = useState({}); // userId -> { stream, state }
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const peers = useRef(new Map());
  const iceRef = useRef(null);
  const streamRef = useRef(null);

  const setPeerState = useCallback((id, patch) => {
    setRemote((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  }, []);

  // 1. Ask for camera and mic once, after the user has clicked "Join the party".
  // Refs (not state) guard this so setting media to "asking" cannot cancel the request it started.
  const askedRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      askedRef.current = false;
      peers.current.forEach((p) => p.pc.close());
      peers.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!enabled || askedRef.current) return;
    askedRef.current = true;
    setMedia('asking');
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (!aliveRef.current) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        setLocalStream(stream);
        setMedia('live');
      } catch (e) {
        if (aliveRef.current) setMedia(e.name === 'NotFoundError' ? 'none' : 'denied');
      }
    })();
  }, [enabled]);

  const send = useCallback(
    (to, type, payload) => socketRef.current?.emit('rtc:signal', { to, type, payload }),
    [socketRef],
  );

  const ensurePeer = useCallback(
    async (id) => {
      if (peers.current.has(id)) return peers.current.get(id);
      if (!iceRef.current) {
        iceRef.current = await api.ice().catch(() => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }));
      }
      if (peers.current.has(id)) return peers.current.get(id);
      const pc = new RTCPeerConnection({ iceServers: iceRef.current.iceServers });
      const peer = { pc, polite: me.userId > id, makingOffer: false, ignoreOffer: false, pending: [] };
      peers.current.set(id, peer);
      setPeerState(id, { state: 'connecting' });

      const local = streamRef.current;
      if (local) local.getTracks().forEach((t) => pc.addTrack(t, local));
      else {
        pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.addTransceiver('video', { direction: 'recvonly' });
      }

      pc.ontrack = ({ streams }) => setPeerState(id, { stream: streams[0] });
      pc.onicecandidate = ({ candidate }) => candidate && send(id, 'ice', candidate);
      pc.onnegotiationneeded = async () => {
        // One side of each pair (the lower user id) makes every offer; the other only answers.
        // Two simultaneous offers force a rollback, and in Chromium a rolled-back connection can get stuck
        // gathering no ICE candidates, so the pair never connects.
        if (peer.polite) return;
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          send(id, 'offer', pc.localDescription);
        } catch {
          /* renegotiation will retry */
        } finally {
          peer.makingOffer = false;
        }
      };
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        setPeerState(id, { state: s === 'connected' ? 'connected' : s === 'failed' || s === 'disconnected' ? 'reconnecting' : 'connecting' });
        if (s === 'failed') pc.restartIce();
      };
      return peer;
    },
    [me, send, setPeerState],
  );

  // 2. Incoming signalling. Messages that arrive before our camera state is settled (still at the join gate,
  // or waiting for permission) are queued, then everything is handled strictly in order. Without this an
  // early offer is lost and both sides wait forever.
  const queueRef = useRef([]);
  const chainRef = useRef(Promise.resolve());
  const readyRef = useRef(false);
  readyRef.current = media !== 'idle' && media !== 'asking';

  const handleSignal = useCallback(
    async ({ from, type, payload }) => {
      const peer = await ensurePeer(from);
      const { pc } = peer;
      try {
        if (type === 'ice') {
          // A candidate can beat the description it belongs to; hold it until the remote description is set.
          if (!pc.remoteDescription) {
            peer.pending.push(payload);
            return;
          }
          try {
            await pc.addIceCandidate(payload);
          } catch (e) {
            if (!peer.ignoreOffer) throw e;
          }
          return;
        }
        const collision = type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(payload);
        for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (type === 'offer') {
          await pc.setLocalDescription();
          send(from, 'answer', pc.localDescription);
        }
      } catch (e) {
        console.warn('signalling error', e);
      }
    },
    [ensurePeer, send],
  );

  const process = useCallback(
    (m) => {
      chainRef.current = chainRef.current.then(() => handleSignal(m)).catch(() => {});
    },
    [handleSignal],
  );

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !me) return undefined;
    const onSignal = (m) => {
      queueRef.current.push(m);
      if (readyRef.current) queueRef.current.splice(0).forEach(process);
    };
    socket.on('rtc:signal', onSignal);
    return () => socket.off('rtc:signal', onSignal);
  }, [socketRef, me, process]);

  useEffect(() => {
    if (!readyRef.current || !queueRef.current.length) return;
    queueRef.current.splice(0).forEach(process);
  }, [media, process]);

  // 3. Connect to everyone who is here, drop everyone who left.
  useEffect(() => {
    if (!me || media === 'idle' || media === 'asking') return;
    const ids = new Set(members.filter((m) => m.userId !== me.userId).map((m) => m.userId));
    ids.forEach((id) => ensurePeer(id));
    peers.current.forEach((p, id) => {
      if (!ids.has(id)) {
        p.pc.close();
        peers.current.delete(id);
        setRemote((r) => {
          const { [id]: _gone, ...rest } = r;
          return rest;
        });
      }
    });
  }, [members, me, media, ensurePeer]);

  const toggle = (kind, setter) => () => {
    const tracks = kind === 'audio' ? streamRef.current?.getAudioTracks() : streamRef.current?.getVideoTracks();
    if (!tracks?.length) return;
    const next = !tracks[0].enabled;
    tracks.forEach((t) => (t.enabled = next));
    setter(next);
  };

  return {
    media,
    localStream,
    remote,
    micOn,
    camOn,
    toggleMic: toggle('audio', setMicOn),
    toggleCam: toggle('video', setCamOn),
  };
}
