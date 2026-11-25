import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['icons/icon.svg', 'apple-touch-icon.png', 'masked-icon.svg'],
            manifest: {
                name: 'The Appden',
                short_name: 'Appden',
                description: 'Tu espacio privado con amigos: musica, deudas y mas.',
                theme_color: '#0f0a08',
                background_color: '#0f0a08',
                display: 'standalone',
                orientation: 'portrait',
                scope: '/',
                start_url: '/',
                icons: [
                    {
                        src: 'icons/icon-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                    },
                    {
                        src: 'icons/icon-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                    {
                        src: 'icons/icon-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'any maskable',
                    },
                ],
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
                cleanupOutdatedCaches: true,
                clientsClaim: true,
                skipWaiting: true,
                runtimeCaching: [
                    {
                        // Covers and avatars from the R2 Worker. The signature in the query string
                        // changes daily, so match ignoring it: the same image is never downloaded twice.
                        // CORS-mode requests (colour extraction) are left to the network to avoid opaque-response clashes.
                        urlPattern: ({ url, request }: { url: URL; request: Request }) =>
                            request.destination === 'image' &&
                            request.mode !== 'cors' &&
                            /^\/f\/(covers|avatars)\//.test(url.pathname),
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'appden-images',
                            expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
                            cacheableResponse: { statuses: [0, 200] },
                            matchOptions: { ignoreSearch: true },
                        },
                    },
                    {
                        // Firebase Auth and Firestore must always hit the network.
                        urlPattern: /^https:\/\/(firestore|identitytoolkit|securetoken)\.googleapis\.com\/.*/i,
                        handler: 'NetworkOnly',
                    },
                ],
                // The application shell must handle navigations. Using
                // offline.html here makes every route render the offline page.
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/api/],
            },
            devOptions: {
                enabled: false, // Disabled in dev - we don't need PWA during development
            },
        }),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@app': path.resolve(__dirname, './src/app'),
            '@components': path.resolve(__dirname, './src/components'),
            '@features': path.resolve(__dirname, './src/features'),
            '@hooks': path.resolve(__dirname, './src/hooks'),
            '@lib': path.resolve(__dirname, './src/lib'),
            '@pages': path.resolve(__dirname, './src/pages'),
            '@services': path.resolve(__dirname, './src/services'),
            '@types': path.resolve(__dirname, './src/types'),
            '@styles': path.resolve(__dirname, './src/styles'),
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ['react', 'react-dom', 'react-router-dom'],
                    firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
                    forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
                    query: ['@tanstack/react-query'],
                    motion: ['framer-motion'],
                    icons: ['lucide-react'],
                },
            },
        },
    },
})
