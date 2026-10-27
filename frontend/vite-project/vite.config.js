import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// When API_PROXY_TARGET is set (on Render), this server forwards /api and the live socket to the backend, so the browser
// only ever talks to ONE address. The login cookie is then first-party, which Safari and iPhones require.
const target = process.env.API_PROXY_TARGET;
const proxy = target
  ? {
      '/api': { target, changeOrigin: true },
      '/health': { target, changeOrigin: true },
      '/socket.io': { target, changeOrigin: true, ws: true },
    }
  : undefined;

export default defineConfig({
  plugins: [react()],
  // The commit this build was made from (Render provides it), shown in the corner and used to spot stale tabs.
  define: { __BUILD__: JSON.stringify((process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 7)) },
  server: { port: 5173 },
  // `vite preview` serves the built app on Render; allow its onrender.com host name.
  preview: { allowedHosts: true, ...(proxy ? { proxy } : {}) },
});
