import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const webPort = Number(process.env['NVS_WEB_PORT'] ?? '4173');
const apiTarget = process.env['NVS_DEV_API_URL'] ?? 'http://127.0.0.1:4100';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
  },
});
