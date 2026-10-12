import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В режиме разработки запросы /api проксируются на сервер (по умолчанию http://127.0.0.1:3000)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.VITE_API_TARGET || 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: { antd: ['antd', '@ant-design/icons'], charts: ['recharts'], leaflet: ['leaflet'] },
      },
    },
  },
});
