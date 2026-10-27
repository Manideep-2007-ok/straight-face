// VITE_API_URL: the backend address, or "/" to use the same address as the page (the page's server forwards /api to the backend).
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'Cannot reach the server. Check your connection and try again.');
  }
  // Free hosting puts the server to sleep when idle; while it wakes up the page's server answers 502/503/504.
  if ([502, 503, 504].includes(res.status)) {
    throw new ApiError(res.status, 'WAKING', 'The server is waking up (free hosting sleeps when idle). Try again in about a minute.');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && json?.error?.code === 'SESSION_REPLACED') window.dispatchEvent(new Event('session-replaced'));
    throw new ApiError(res.status, json?.error?.code || 'ERROR', json?.error?.message || 'Something went wrong.');
  }
  return json.data;
}

export const api = {
  signup: (b) => request('/api/auth/signup', { method: 'POST', body: b }),
  login: (b) => request('/api/auth/login', { method: 'POST', body: b }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
  createRoom: (name) => request('/api/rooms', { method: 'POST', body: { name } }),
  myRooms: () => request('/api/rooms/mine'),
  room: (code) => request(`/api/rooms/${encodeURIComponent(code)}`),
  ice: () => request('/api/rtc/ice'),
  sessions: (code) => request(`/api/sessions?code=${encodeURIComponent(code)}`),
  recap: (id) => request(`/api/sessions/${encodeURIComponent(id)}/recap`),
};
