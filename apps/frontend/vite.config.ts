import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'
import { readFileSync } from 'fs'
import { resolve } from 'path'
// @ts-expect-error - JS config file
import { APP_NAME, APP_SHORT_NAME } from './app.config.js'

// Read package.json for app metadata
const rootPackageJson = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')
)

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_NAME__: JSON.stringify(APP_NAME),
    __APP_SHORT_NAME__: JSON.stringify(APP_SHORT_NAME),
    __APP_VERSION__: JSON.stringify(rootPackageJson.version),
  },
  resolve: {
    // Ensure a single React instance to avoid invalid hook calls during dev HMR
    dedupe: ['react', 'react-dom'],
    alias: {
      react: resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
  plugins: [
    react(),
    // Bundle size visualizer (only in build mode with ANALYZE=true)
    process.env.ANALYZE === 'true' &&
    visualizer({
      open: true,
      gzipSize: true,
      brotliSize: true,
      filename: 'dist/stats.html',
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icon.svg',
        'vite.svg',
        'icon-192x192.png',
        'icon-512x512.png',
        'icon-192x192-maskable.png',
        'icon-512x512-maskable.png',
        'apple-touch-icon.png',
        'icon-96x96.png',
        'icon-144x144.png',
        'icon-256x256.png',
        'icon-384x384.png'
      ],
      manifest: {
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: 'Companion for Technitium DNS Servers',
        theme_color: '#4F46E5',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-192x192-maskable.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/icon-512x512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/icon-96x96.png',
            sizes: '96x96',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-144x144.png',
            sizes: '144x144',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-256x256.png',
            sizes: '256x256',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-384x384.png',
            sizes: '384x384',
            type: 'image/png',
            purpose: 'any'
          }
        ],
        shortcuts: [
          {
            name: 'Query Logs',
            short_name: 'Logs',
            description: 'View DNS query logs',
            url: '/logs',
            icons: [{ src: '/icon-96x96.png', sizes: '96x96', type: 'image/png' }]
          },
          {
            name: 'DNS Zones',
            short_name: 'Zones',
            description: 'Manage DNS zones',
            url: '/zones',
            icons: [{ src: '/icon-96x96.png', sizes: '96x96', type: 'image/png' }]
          },
          {
            name: 'Configuration',
            short_name: 'Config',
            description: 'Sync DNS configuration',
            url: '/configuration',
            icons: [{ src: '/icon-96x96.png', sizes: '96x96', type: 'image/png' }]
          }
        ]
      },
      workbox: {
        // Cache strategy configuration
        runtimeCaching: [
          {
            // API calls: Network-first with 5s timeout, fallback to cache
            urlPattern: /^https?:\/\/.*\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 5, // 5 minutes
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // Static assets: Cache-first with versioning
            urlPattern: /\.(?:js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              }
            }
          },
          {
            // HTML pages: Network-first
            urlPattern: /\.html$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              }
            }
          }
        ],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
      devOptions: {
        enabled: false, // Disable PWA in dev mode for easier debugging
        type: 'module'
      }
    })
  ],
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
  },
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: process.env.VITE_HTTPS_ENABLED === 'true'
      ? parseInt(process.env.VITE_HTTPS_PORT || '5174', 10)
      : 5173,
    allowedHosts: true, // Allow any host (for remote development)
    // HTTPS Configuration (optional)
    // Enable by setting VITE_HTTPS_ENABLED=true and providing certificate paths
    https: process.env.VITE_HTTPS_ENABLED === 'true' ? {
      cert: readFileSync(resolve(process.env.VITE_HTTPS_CERT_PATH || './certs/server.crt')),
      key: readFileSync(resolve(process.env.VITE_HTTPS_KEY_PATH || './certs/server.key')),
    } : undefined,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        secure: false, // Allow self-signed certificates in development
      },
    },
  },
  build: {
    // Target modern browsers for smaller bundle sizes
    target: 'es2020',
    // Increase chunk size warning limit (we're code-splitting, so larger chunks are OK)
    chunkSizeWarningLimit: 1000,
    // Enable minification and tree-shaking
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.logs in production
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        // Optimize chunk naming for better caching
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks: (id: string) => {
          // Pages - code-split by route for lazy loading
          if (id.includes('ConfigurationPage')) {
            return 'page-configuration'
          }
          if (id.includes('LogsPage')) {
            return 'page-logs'
          }
          if (id.includes('ZonesPage')) {
            return 'page-zones'
          }
          if (id.includes('DhcpPage')) {
            return 'page-dhcp'
          }
          if (id.includes('DnsLookupPage')) {
            return 'page-dns-lookup'
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**', // Exclude Playwright E2E tests - run those with 'npm run test:e2e'
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
    ],
  },
})