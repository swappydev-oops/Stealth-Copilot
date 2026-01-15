import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  console.log("env:", env);
  console.log("apiKey: ", apiKey);

  // IMPORTANT: must match GitHub repo name exactly
  base: '/Stealth-Copilot/',
  define: { 'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY), 'process.env.GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY) },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },

  server: {
    port: 3000,
    host: '0.0.0.0',
  },
});
