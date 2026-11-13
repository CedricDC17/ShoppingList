// vite.config.js
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const isDev = process.env.NODE_ENV !== 'production'

/**
 * En dev, sert la fonction Vercel api/ai.js sur /api/ai, pour tester l'IA
 * avec `npm run dev` sans passer par `vercel dev`. La clé est lue dans .env
 * (AI_API_KEY, sans préfixe VITE_ : elle ne doit pas finir dans le front).
 */
function devApi() {
  return {
    name: 'dev-api',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '')
      for (const [key, value] of Object.entries(env)) {
        if (!(key in process.env)) process.env[key] = value
      }
      server.middlewares.use('/api/ai', async (req, res) => {
        let raw = ''
        for await (const chunk of req) raw += chunk
        try {
          req.body = raw ? JSON.parse(raw) : {}
        } catch {
          req.body = raw
        }
        res.status = code => {
          res.statusCode = code
          return res
        }
        res.json = data => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        }
        const { default: handler } = await server.ssrLoadModule('/api/ai.js')
        await handler(req, res)
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    devApi(),
    VitePWA({
      registerType: 'autoUpdate',
      // active le SW uniquement en dev
      devOptions: {
        enabled: isDev
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'firebase-images',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              }
            }
          }
        ]
      },
      manifest: {
        name: 'Liste Courses',
        short_name: 'Liste Courses',
        description: 'Liste de courses familiale, planning de repas et recettes.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0D2B1F',
        theme_color: '#0D2B1F',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],

  // Ne sert que pour le dev local, Vercel l'ignorera
  ...(isDev && {
    server: {
      host: true,
      port: 5173,
      allowedHosts: 'all'
    }
  })
})
