import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

export default function Landing() {
  const { user } = useAuth();
  return (
    <main className="center-screen">
      <div className="stack" style={{ maxWidth: 640 }}>
        <p className="mono muted" style={{ letterSpacing: '0.04em' }}>STRAIGHT FACE</p>
        <h1 style={{ fontSize: 'clamp(2.5rem, 7vw, 4.5rem)' }}>Watch together. Keep a straight face.</h1>
        <p className="muted" style={{ fontSize: '1.125rem' }}>
          Up to four friends watch the same YouTube video in sync, talk on voice and video, and chat.
          Your camera is read in your own browser to run a Don't Laugh game. No video is uploaded.
        </p>
        <div className="row">
          <Link to={user ? '/home' : '/signup'} className="btn btn-primary" style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>
            {user ? 'Go to your rooms' : 'Create a room'}
          </Link>
          {!user && (
            <Link to="/login" className="btn btn-ghost" style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>
              Log in
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
