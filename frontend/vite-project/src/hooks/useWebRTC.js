import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api.js';

// Full-mesh WebRTC using "perfect negotiation" so two people joining at once cannot deadlock.
// media: 'idle' | 'asking' | 'live' | 'denied' | 'none'   (denied/none = watch + chat only)
export function useWebRTC({ socketRef, me, members, enabled, epoch = 0 }) {
  const [media, setMedia] = useState('idle');
  const [localStream, setLocalStream] = useState(null);
  const [remote, setRemote] = useState({}); // userId -> { stream, state }
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [hasTurn, setHasTurn] = useState(false);
  const [tick, setTick] = useState(0); // bumped to make the "connect to everyone" step run again
  const attempts = useRef(new Map()); // userId -> automatic rebuilds so far
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

  // Throw a call away so a fresh one is built. `notify` tells the other person to do the same: a new call cannot
  // be matched with the old one on the other side (the encryption keys differ).
  const resetPeer = useCallback(
    (id, notify = false) => {
      const p = peers.current.get(id);
      if (p) {
        p.pc.onconnectionstatechange = null;
        p.pc.close();
        peers.current.delete(id);
      }
      setRemote((r) => {
        const { [id]: _gone, ...rest } = r;
        return rest;
      });
      if (notify) socketRef.current?.emit('rtc:signal', { to: id, type: 'reset' });
      setTick((t) => t + 1);
    },
    [socketRef],
  );

  // Rebuild a broken call by itself, a few times, with a growing pause.
  const recover = useCallback(
    (id) => {
      const n = attempts.current.get(id) || 0;
      if (n >= 3) return;
      attempts.current.set(id, n + 1);
      setTimeout(() => peers.current.has(id) && resetPeer(id, true), 1500 * (n + 1));
    },
    [resetPeer],
  );

  // Tell the server how a call is going (counts and types of network paths only, never addresses).
  const diag = useCallback((id, event, info) => socketRef.current?.emit('rtc:diag', { peer: id, event, ...(info ? { info } : {}) }), [socketRef]);

  const ensurePeer = useCallback(
    async (id) => {
      if (peers.current.get(id)?.pc.signalingState === 'closed') peers.current.delete(id);
      if (peers.current.has(id)) return peers.current.get(id);
      if (!iceRef.current) {
        iceRef.current = await api.ice().catch(() => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], hasTurn: false }));
        setHasTurn(!!iceRef.current.hasTurn);
      }
      if (peers.current.has(id)) return peers.current.get(id);
      const pc = new RTCPeerConnection({ iceServers: iceRef.current.iceServers });
      const peer = { pc, polite: me.userId > id, makingOffer: false, ignoreOffer: false, pending: [], since: Date.now(), local: {}, remote: {} };
      const kind = (c) => (/\.local /.test(c) ? 'mdns' : /typ (\w+)/.exec(c)?.[1] || 'other') + (/ tcp /i.test(c) ? '-tcp' : '');
      peer.kind = kind;
      diag(id, 'start', {
        role: me.userId > id ? 'answerer' : 'offerer',
        turn: !!iceRef.current?.hasTurn,
        net: navigator.connection?.type || navigator.connection?.effectiveType || 'unknown',
        brave: !!navigator.brave,
        ua: navigator.userAgent.replace(/\(([^)]*)\)/, (m, g) => `(${g.split(';').slice(0, 2).join(';')})`).slice(0, 110),
      });
      peers.current.set(id, peer);
      setPeerState(id, { state: 'connecting' });

      const local = streamRef.current;
      if (local) local.getTracks().forEach((t) => pc.addTrack(t, local));
      else {
        pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.addTransceiver('video', { direction: 'recvonly' });
      }

      pc.ontrack = ({ streams }) => setPeerState(id, { stream: streams[0] });
      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) return diag(id, 'gathering done', { local: peer.local });
        const k = kind(candidate.candidate);
        peer.local[k] = (peer.local[k] || 0) + 1;
        send(id, 'ice', candidate);
      };
      pc.oniceconnectionstatechange = () => diag(id, `ice ${pc.iceConnectionState}`, { local: peer.local, remote: peer.remote });
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
        peer.since = Date.now();
        diag(id, `connection ${s}`, { local: peer.local, remote: peer.remote });
        if (s === 'connected') {
          attempts.current.delete(id);
          setPeerState(id, { state: 'connected' });
          // which kind of path was chosen (direct, via a STUN-found address, or relayed)
          pc.getStats().then((rep) => {
            let sel;
            rep.forEach((r) => r.type === 'transport' && r.selectedCandidatePairId && (sel = rep.get(r.selectedCandidatePairId)));
            if (sel) diag(id, 'path', { local: rep.get(sel.localCandidateId)?.candidateType, remote: rep.get(sel.remoteCandidateId)?.candidateType, proto: rep.get(sel.localCandidateId)?.protocol });
          }).catch(() => {});
        } else if (s === 'failed') {
          setPeerState(id, { state: 'failed' });
          pc.getStats().then((rep) => {
            const pairs = {};
            rep.forEach((r) => r.type === 'candidate-pair' && (pairs[r.state] = (pairs[r.state] || 0) + 1));
            diag(id, 'failed: candidate pairs by state', pairs);
          }).catch(() => {});
          recover(id);
        } else if (s === 'disconnected') setPeerState(id, { state: 'reconnecting' });
        else setPeerState(id, { state: 'connecting' });
      };
      return peer;
    },
    [me, send, setPeerState, recover, diag],
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
      if (type === 'reset') {
        resetPeer(from, false); // the other side threw its call away; build a new one with them
        return;
      }
      const peer = await ensurePeer(from);
      const { pc } = peer;
      try {
        if (type === 'ice') {
          const k = peer.kind?.(payload?.candidate || '') || 'other';
          peer.remote[k] = (peer.remote[k] || 0) + 1;
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
    [ensurePeer, send, resetPeer],
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
      if (m.channel === 'screen') return; // belongs to screen sharing (useShare)
      queueRef.current.push(m);
      if (readyRef.current) queueRef.current.splice(0).forEach(process);
    };
    const onReset = ({ userId }) => resetPeer(userId, false);
    socket.on('rtc:signal', onSignal);
    socket.on('rtc:reset', onReset);
    return () => {
      socket.off('rtc:signal', onSignal);
      socket.off('rtc:reset', onReset);
    };
  }, [socketRef, me, process, resetPeer]);

  // After WE reconnected, every call we had is dead: start all of them again.
  useEffect(() => {
    if (epoch > 1) [...peers.current.keys()].forEach((id) => resetPeer(id, false));
  }, [epoch, resetPeer]);

  // Watchdog: a call stuck "disconnected" for 8 s, or never getting connected for 25 s, is rebuilt.
  useEffect(() => {
    const t = setInterval(() => {
      peers.current.forEach((p, id) => {
        const age = Date.now() - p.since;
        const s = p.pc.connectionState;
        const dead = s === 'closed' || p.pc.signalingState === 'closed'; // e.g. a phone browser suspended the tab
        if (dead || (s === 'disconnected' && age > 8000) || ((s === 'new' || s === 'connecting') && age > 25000)) {
          p.since = Date.now();
          recover(id);
        }
      });
    }, 5000);
    return () => clearInterval(t);
  }, [recover]);

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
  }, [members, me, media, ensurePeer, tick]);

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
    hasTurn,
    retry: (id) => {
      attempts.current.delete(id);
      resetPeer(id, true);
    },
    toggleMic: toggle('audio', setMicOn),
    toggleCam: toggle('video', setCamOn),
  };
}
