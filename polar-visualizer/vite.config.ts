import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { execFile } from 'child_process'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * Vite plugin: POST /api/sync-config writes sync-result.json to public/<trackFolder>/
 * Used by camera head position UI to persist config alongside track data.
 */
function syncConfigPlugin(): Plugin {
  return {
    name: 'sync-config-writer',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.url === '/api/sync-config' && req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const { trackFolder, config } = JSON.parse(body)
              if (!trackFolder || trackFolder.includes('..') || /^[/\\]/.test(trackFolder)) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Invalid track folder' }))
                return
              }
              const dir = resolve(__dirname, 'public', trackFolder)
              mkdirSync(dir, { recursive: true })
              const filePath = resolve(dir, 'sync-result.json')
              writeFileSync(filePath, JSON.stringify(config, null, 2))
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, path: filePath }))
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e)
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: msg }))
            }
          })
          return
        }
        next()
      })
    }
  }
}

/**
 * Vite plugin: POST /api/calc-timing runs tools/calc-timing.js on an edit folder.
 * Body: { "editFolder": "C:\\...\\edit\\25-05-03\\05-03-2025-2", "scheme": "Clip2" (optional) }
 * Returns the generated sync-result.json content.
 */
function calcTimingPlugin(): Plugin {
  return {
    name: 'calc-timing-runner',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.url === '/api/calc-timing' && req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const { editFolder, scheme } = JSON.parse(body)
              if (!editFolder || typeof editFolder !== 'string') {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'editFolder is required' }))
                return
              }

              // Resolve calc-timing.js relative to project root (one level up from polar-visualizer)
              const scriptPath = resolve(__dirname, '..', 'tools', 'calc-timing.js')
              if (!existsSync(scriptPath)) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: `calc-timing.js not found at ${scriptPath}` }))
                return
              }

              const args = [scriptPath, editFolder, '--json']
              if (scheme) { args.push('--scheme', scheme) }

              execFile('node', args, { timeout: 30000 }, (err: Error | null, stdout: string, stderr: string) => {
                if (err) {
                  console.error('[calc-timing] error:', err.message)
                  console.error('[calc-timing] stderr:', stderr)
                  res.writeHead(500, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ error: err.message, stderr }))
                  return
                }

                // Read back the sync-result.json that calc-timing.js wrote
                const resultPath = resolve(editFolder, 'sync-result.json')
                if (!existsSync(resultPath)) {
                  res.writeHead(500, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ error: 'calc-timing ran but sync-result.json not found', stdout, stderr }))
                  return
                }

                const resultJson = readFileSync(resultPath, 'utf-8')
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(resultJson)
              })
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e)
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: msg }))
            }
          })
          return
        }
        next()
      })
    }
  }
}

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false,
    fs: {
      strict: false,     // allow /@fs/ access to absolute paths (gyroflow CSV in cloud storage)
    },
  },
  plugins: [syncConfigPlugin(), calcTimingPlugin()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        gps: resolve(__dirname, 'gps.html'),
      },
    },
  }
})
