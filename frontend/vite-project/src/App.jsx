import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth.jsx';
import Landing from './pages/Landing.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Home from './pages/Home.jsx';
import Room from './pages/Room.jsx';
import Recap from './pages/Recap.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center-screen muted" role="status">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/home" element={<Protected><Home /></Protected>} />
      <Route path="/room/:code" element={<Protected><Room /></Protected>} />
      <Route path="/room/:code/recap/:id?" element={<Protected><Recap /></Protected>} />
      <Route path="*" element={<div className="center-screen"><p>Page not found. <a href="/">Go home</a></p></div>} />
    </Routes>
  );
}
