import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import '../styles/recap.css';

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ytLink = (videoId, t) => `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(t)}s`;

// Heat strip: one amber bar per second, opacity = how many people cracked up. Peaks get a flag.
function HeatStrip({ strip }) {
  const { heat, length, peaks, videoId } = strip;
  const H = 40;
  return (
    <figure className="heat">
      <svg viewBox={`0 0 ${length} ${H + 22}`} preserveAspectRatio="none" role="img" aria-label={`Laughter heat across ${fmt(length)} of video. ${peaks.length} peak moments.`}>
        <rect x="0" y="22" width={length} height={H} fill="var(--surface)" />
        {heat.map((v, t) => v > 0 && <rect key={t} x={t} y={22} width="1.05" height={H} fill="var(--glow)" opacity={Math.min(1, 0.15 + v * 0.95)} />)}
        {peaks.map((p) => <line key={p.t} x1={p.t + 0.5} x2={p.t + 0.5} y1="14" y2={22 + H} stroke="var(--text)" strokeWidth={length / 400} vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="flags">
        {peaks.map((p) => (
          <a key={p.t} className="flag mono" style={{ left: `${(p.t / length) * 100}%` }} href={ytLink(videoId, p.t)} target="_blank" rel="noreferrer" title="Open the video at this moment">
            {fmt(p.t)}
          </a>
        ))}
      </div>
      <figcaption className="muted">
        {peaks.length ? 'Brighter means more of the room cracked up. Click a time to jump to it on YouTube.' : 'No big laughs this time.'}
      </figcaption>
    </figure>
  );
}

export default function Recap() {
  const { code, id } = useParams();
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [recap, setRecap] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.sessions(code).then(setList).catch((e) => setError(e.message));
  }, [code]);

  useEffect(() => {
    if (!list) return;
    const target = id || list[0]?.id;
    if (!target) return;
    setRecap(null);
    api.recap(target).then(setRecap).catch((e) => setError(e.message));
  }, [list, id]);

  return (
    <main className="recap">
      <header className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '1.75rem' }}>Party recap <span className="mono muted">{code}</span></h1>
        <Link to="/home" className="btn btn-ghost" style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>Back to your rooms</Link>
      </header>

      {error && <p className="error-text" role="alert">{error}</p>}
      {!list && !error && <p className="muted" role="status">Loading…</p>}
      {list && list.length === 0 && <p className="muted">No parties here yet. Watch something together, then come back.</p>}

      {list && list.length > 0 && (
        <nav className="past" aria-label="Past parties">
          {list.map((s) => (
            <button key={s.id} className={`chip${(id || list[0].id) === s.id ? ' on' : ''}`} onClick={() => navigate(`/room/${code}/recap/${s.id}`)}>
              {new Date(s.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}{s.sample ? ' · sample' : ''}
            </button>
          ))}
        </nav>
      )}

      {list?.length > 0 && !recap && !error && <p className="muted" role="status">Loading recap…</p>}

      {recap && (
        <>
          {recap.sample && <p className="sample-note" role="note">Sample party. This is demo data, not a real watch session.</p>}
          <p className="muted">With {recap.participants.join(', ')}.</p>

          <section>
            <h2>Reaction Radar</h2>
            {recap.heat.length === 0 && <p className="muted">No reactions were recorded. Turn on face reactions in the room to fill this in.</p>}
            {recap.heat.map((h) => <HeatStrip key={h.videoId} strip={h} />)}
          </section>

          <section>
            <h2>Awards</h2>
            {recap.awards.length === 0 ? <p className="muted">No awards yet. They need a Don't Laugh round or some reactions.</p> : (
              <ul className="awards">
                {recap.awards.map((a) => (
                  <li key={a.key} className="glass">
                    <span className="muted">{a.title}</span>
                    <strong>{a.name}</strong>
                    <span className="mono muted">{a.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>Rounds</h2>
            {recap.rounds.length === 0 ? <p className="muted">No Don't Laugh rounds.</p> : (
              <ul className="plain">
                {recap.rounds.map((r, i) => (
                  <li key={i}>
                    Winner: <strong>{r.winners.join(' and ') || 'nobody'}</strong>. {r.outcomes.filter((o) => o.outAtT != null).map((o) => `${o.name} cracked at ${fmt(o.outAtT)}`).join(', ')}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {recap.chatMoments.length > 0 && (
            <section>
              <h2>Chattiest moments</h2>
              <ul className="plain">
                {recap.chatMoments.map((m) => (
                  <li key={`${m.videoId}${m.t}`}><a className="mono" href={ytLink(m.videoId, m.t)} target="_blank" rel="noreferrer">{fmt(m.t)}</a> · {m.count} message{m.count > 1 ? "s" : ""}, like "{m.sample}"</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
