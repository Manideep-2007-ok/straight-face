export const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Same rules as backend/logic/youtube.js. Returns the 11-char id or null.
export function parseYouTubeId(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (YT_ID_RE.test(s)) return s;
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
      if (m) id = m[1];
    }
  }
  return id && YT_ID_RE.test(id) ? id : null;
}

let apiPromise;
export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject(new Error('Could not load the YouTube player.'));
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}
