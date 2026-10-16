import fs from 'node:fs'
import path from 'node:path'
import type { Connect } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const VIEWS_FILE = path.resolve(import.meta.dirname, 'views.json')

// Saved views live in a JSON file next to the app rather than only in the browser, so they
// survive clearing site data and don't depend on which port the dev server landed on.
const viewsFileApi: Connect.NextHandleFunction = (req, res, next) => {
  if (req.url !== '/local-api/views') return next()
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'GET') {
    if (!fs.existsSync(VIEWS_FILE)) return res.end('null')
    return res.end(fs.readFileSync(VIEWS_FILE, 'utf8'))
  }

  if (req.method === 'PUT') {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        const views = JSON.parse(body)
        if (!Array.isArray(views)) throw new Error('expected an array of views')
        // Write-then-rename so a crash mid-write can't leave a truncated file.
        const tmp = `${VIEWS_FILE}.tmp`
        fs.writeFileSync(tmp, JSON.stringify(views, null, 2) + '\n')
        fs.renameSync(tmp, VIEWS_FILE)
        res.end('{"ok":true}')
      } catch (e) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: String((e as Error).message) }))
      }
    })
    return
  }

  res.statusCode = 405
  res.end('{"error":"method not allowed"}')
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.CEKURA_API_KEY
  const target = env.CEKURA_API_URL || 'https://api.cekura.ai'

  return {
    plugins: [
      react(),
      {
        name: 'local-views-file',
        configureServer: (server) => { server.middlewares.use(viewsFileApi) },
        configurePreviewServer: (server) => { server.middlewares.use(viewsFileApi) },
      },
    ],
    server: {
      port: 5173,
      watch: { ignored: [VIEWS_FILE, `${VIEWS_FILE}.tmp`] },
      proxy: {
        // Keeps the API key server-side: the browser talks to /cekura and the dev server adds the key.
        '/cekura': {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/cekura/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (req) => {
              if (apiKey && !req.getHeader('x-cekura-api-key')) req.setHeader('X-CEKURA-API-KEY', apiKey)
            })
          },
        },
      },
    },
  }
})
