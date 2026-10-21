import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.jsx';

export default function Home() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.myRooms().then(setRooms).catch((e) => setLoadError(e.message));
  }, []);

  async function create(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const room = await api.createRoom(name);
      navigate(`/room/${room.code}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function join(e) {
    e.preventDefault();
    setError('');
    const c = code.trim().toUpperCase();
    try {
      await api.room(c);
      navigate(`/room/${c}`);
    } catch (err) {
      setError(err.status === 404 || err.status === 400 ? 'No room with that code. Check it and try again.' : err.message);
    }
  }

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: 'var(--s6)' }}>
      <header className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--s8)' }}>
        <h1 style={{ fontSize: '1.75rem' }}>Hi, {user.name}</h1>
        <button className="btn btn-ghost" onClick={logout}>Log out</button>
      </header>

      {error && <p className="error-text" role="alert">{error}</p>}

      <div style={{ display: 'grid', gap: 'var(--s6)', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <form className="glass" style={{ padding: 'var(--s6)' }} onSubmit={create}>
          <h2 style={{ fontSize: '1.375rem', marginBottom: 'var(--s4)' }}>Create a room</h2>
          <div className="field">
            <label htmlFor="rname">Room name</label>
            <input id="rname" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </div>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>Create room</button>
        </form>

        <form className="glass" style={{ padding: 'var(--s6)' }} onSubmit={join}>
          <h2 style={{ fontSize: '1.375rem', marginBottom: 'var(--s4)' }}>Join with a code</h2>
          <div className="field">
            <label htmlFor="rcode">Room code</label>
            <input id="rcode" className="mono" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} style={{ textTransform: 'uppercase' }} required />
          </div>
          <button className="btn" disabled={code.trim().length !== 6}>Join room</button>
        </form>
      </div>

      <section style={{ marginTop: 'var(--s12)' }}>
        <h2 style={{ fontSize: '1.375rem', marginBottom: 'var(--s4)' }}>Your rooms</h2>
        {loadError && <p className="error-text" role="alert">{loadError}</p>}
        {!rooms && !loadError && <p className="muted" role="status">Loading…</p>}
        {rooms && rooms.length === 0 && <p className="muted">No rooms yet. Create one above to get a code you can share.</p>}
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--s3)' }}>
          {rooms?.map((r) => (
            <li key={r.code}>
              <button className="glass" style={{ width: '100%', padding: 'var(--s4)', textAlign: 'left', color: 'var(--text)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onClick={() => navigate(`/room/${r.code}`)}>
                <span>{r.name}</span>
                <span className="mono muted">{r.code}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
