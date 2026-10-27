import { useEffect, useState } from 'react';

// A page that stays open keeps running the code it loaded. When a newer build is deployed this says so, because an old
// page can silently stop working with new ones (for example it cannot answer a "rebuild the call" request).
export default function UpdateBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (__BUILD__ === 'dev') return undefined;
    let dead = false;
    const check = async () => {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        const j = await r.json();
        if (!dead && j.build && j.build !== 'dev' && j.build !== __BUILD__) setStale(true);
      } catch {
        /* offline or no version file: nothing to say */
      }
    };
    check();
    const id = setInterval(check, 60000);
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      dead = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return (
    <>
      {stale && (
        <div className="update-banner" role="alert">
          A newer version of Straight Face is available.
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload now</button>
        </div>
      )}
      <span className="build-label" aria-hidden="true">v {__BUILD__}</span>
    </>
  );
}
