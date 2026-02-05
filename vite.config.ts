import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const isProd = mode === 'production';
    const apiBaseUrl = isProd ? '' : (env.API_BASE_URL || env.VITE_API_BASE_URL || 'http://localhost:3000');
    return {
      server: {
        port: 5174,
        host: '0.0.0.0',
        allowedHosts: ['localhost', '127.0.0.1', '192.168.12.86', '.trycloudflare.com'],
        proxy: {
          '/api': {
            target: 'http://localhost:3000',
            changeOrigin: true
          },
          '/uploads': {
            target: 'http://localhost:3000',
            changeOrigin: true
          }
        }
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.API_BASE_URL': JSON.stringify(apiBaseUrl)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
