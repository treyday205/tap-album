import path from 'path';
import os from 'os';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const getLanAddress = () => {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry && entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return '';
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiBaseUrl = env.VITE_API_URL || 'http://localhost:4000';
  const proxyTarget = /^https?:\/\//i.test(apiBaseUrl)
    ? apiBaseUrl
    : 'http://localhost:4000';

  return {
    server: {
      port: 5174,
      host: '0.0.0.0',
      allowedHosts: ['localhost', '127.0.0.1', '192.168.12.86', '.trycloudflare.com'],
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true
        },
        '/uploads': {
          target: proxyTarget,
          changeOrigin: true
        }
      }
    },
    plugins: [
      react(),
      {
        name: 'tap-dev-lan-log',
        configureServer(server) {
          if (server.config.mode === 'production') return;
          const port = server.config.server.port ?? 5174;
          const lanIp = getLanAddress();
          if (lanIp) {
            console.log(`[TAP] LAN URL: http://${lanIp}:${port}`);
          } else {
            console.log(`[TAP] LAN URL: http://localhost:${port}`);
          }
        }
      },
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: null,
        includeAssets: [
          'icons/icon-180.png',
          'icons/icon-192.png',
          'icons/icon-512.png',
          'icons/icon-maskable-512.png'
        ],
        manifest: {
          name: 'TAP Album',
          short_name: 'TAP',
          description: 'Install TAP to stream live albums like a native app.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          display_override: ['fullscreen', 'standalone', 'minimal-ui'],
          orientation: 'portrait',
          background_color: '#020617',
          theme_color: '#020617',
          icons: [
            {
              src: '/icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ]
        },
        workbox: {
          cleanupOutdatedCaches: true,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.destination === 'image',
              handler: 'CacheFirst',
              options: {
                cacheName: 'tap-images',
                expiration: {
                  maxEntries: 80,
                  maxAgeSeconds: 60 * 60 * 24 * 30
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'tap-google-fonts-css',
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
              handler: 'CacheFirst',
              options: {
                cacheName: 'tap-google-fonts',
                expiration: {
                  maxEntries: 16,
                  maxAgeSeconds: 60 * 60 * 24 * 365
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: ({ url }) => url.origin === 'https://cdn.tailwindcss.com',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'tap-tailwind-cdn',
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            }
          ]
        },
        devOptions: {
          enabled: false
        }
      })
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    build: {
      minify: 'esbuild',
      sourcemap: false,
      cssCodeSplit: true,
      target: 'es2019'
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.')
      }
    }
  };
});