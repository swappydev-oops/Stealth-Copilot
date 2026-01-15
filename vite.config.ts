import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify("AIzaSyD5BI2VQvwcxnStF0ut-0PmRGI52x6A4Eg"),
        'process.env.GEMINI_API_KEY': JSON.stringify("AIzaSyD5BI2VQvwcxnStF0ut-0PmRGI52x6A4Eg")
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      base: "/Stealth-Copilot/",
    };
});
