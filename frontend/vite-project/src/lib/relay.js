// The free relay (TURN) server has a small monthly data allowance, so a call that has to go THROUGH it is sent at a
// lower quality. Calls that connect directly are untouched and stay at full quality.

// True when the connection the browser picked goes through the relay server.
export async function isRelayed(pc) {
  try {
    const rep = await pc.getStats();
    let sel;
    rep.forEach((r) => r.type === 'transport' && r.selectedCandidatePairId && (sel = rep.get(r.selectedCandidatePairId)));
    if (!sel) return false;
    return rep.get(sel.localCandidateId)?.candidateType === 'relay' || rep.get(sel.remoteCandidateId)?.candidateType === 'relay';
  } catch {
    return false;
  }
}

// Camera call over the relay: about 150 kbit/s picture (320x180 at 15 fps) and 24 kbit/s sound.
export const CAMERA_LIMITS = { videoBps: 150_000, scale: 2, fps: 15, audioBps: 24_000 };
// A shared screen or file over the relay: readable, but a fraction of the normal 2.5 Mbit/s.
export const SHARE_LIMITS = { videoBps: 500_000, scale: 1.5, fps: 15, audioBps: 48_000 };

export async function limitSenders(pc, limits) {
  for (const sender of pc.getSenders()) {
    if (!sender.track) continue;
    const params = sender.getParameters();
    params.encodings = params.encodings?.length ? params.encodings : [{}];
    if (sender.track.kind === 'video') {
      params.encodings[0].maxBitrate = limits.videoBps;
      params.encodings[0].maxFramerate = limits.fps;
      params.encodings[0].scaleResolutionDownBy = limits.scale;
    } else {
      params.encodings[0].maxBitrate = limits.audioBps;
    }
    // eslint-disable-next-line no-await-in-loop
    await sender.setParameters(params).catch(() => {});
  }
}

// The same servers without the relay (TURN) ones. Calls start with these so a direct path is never beaten by a relay path.
export const withoutRelay = (servers) => servers.filter((srv) => !(Array.isArray(srv.urls) ? srv.urls : [srv.urls]).some((u) => /^turns?:/i.test(u)));
