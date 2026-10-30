import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ponytail: dev server on fixed port for Phase 0; add proxy/HMR tuning only if something breaks.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  define: {
    'process.env.EXPLABS_API_KEY': JSON.stringify(process.env.EXPLABS_API_KEY || ''),
  },
});
