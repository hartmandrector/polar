import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
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

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false,
    fs: {
      strict: false,     // allow /@fs/ access to absolute paths (gyroflow CSV in cloud storage)
    },
  },
  plugins: [syncConfigPlugin()],
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
