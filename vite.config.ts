import fs from 'node:fs'
import os from 'node:os'
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

// Branch and agent IDs are opaque, so names come from the ai-receptionist repo's managed
// ElevenLabs environments (one environments.json per agent family) when it's checked out.
function elevenLabsNamesApi(dir: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.url !== '/local-api/elevenlabs-names') return next()
    const agents: Record<string, string> = {}
    const branches: Record<string, string> = {}
    try {
      for (const family of fs.readdirSync(dir)) {
        const file = path.join(dir, family, 'environments.json')
        if (!fs.existsSync(file)) continue
        const envs = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { agent_id?: string; branch_id?: string; name?: string }>
        for (const [env, e] of Object.entries(envs)) {
          if (e.agent_id && (e.name || !agents[e.agent_id])) agents[e.agent_id] = e.name ?? `${family} (${env})`
          if (e.branch_id) branches[e.branch_id] = family === 'beau' ? env : `${family}/${env}`
        }
      }
    } catch { /* repo not present: the UI falls back to raw IDs */ }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ agents, branches }))
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.CEKURA_API_KEY
  const target = env.CEKURA_API_URL || 'https://api.cekura.ai'
  const managedAgentsDir = env.ELEVENLABS_MANAGED_AGENTS_DIR ||
    path.join(os.homedir(), 'boulevard/ai-receptionist/packages/elevenlabs/agents/_managed')
  const namesApi = elevenLabsNamesApi(managedAgentsDir)

  return {
    plugins: [
      react(),
      {
        name: 'local-views-file',
        configureServer: (server) => { server.middlewares.use(viewsFileApi); server.middlewares.use(namesApi) },
        configurePreviewServer: (server) => { server.middlewares.use(viewsFileApi); server.middlewares.use(namesApi) },
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
