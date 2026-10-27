import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // `vite preview` serves the built app on Render; allow its onrender.com host name.
  preview: { allowedHosts: true },
});
