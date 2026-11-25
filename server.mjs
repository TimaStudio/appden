// Static server for Firebase App Hosting: serves the Vite build in dist/ with SPA fallback.
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist')
const PORT = Number(process.env.PORT) || 8080

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
}

const NO_CACHE = new Set(['/index.html', '/sw.js', '/manifest.webmanifest'])

async function resolveFile(urlPath) {
    const safe = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.(\/|\\|$))+/, '')
    const candidate = join(ROOT, safe)
    if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null
    try {
        const info = await stat(candidate)
        if (info.isFile()) return { path: candidate, size: info.size }
    } catch {
        // Not a file: fall through to the SPA shell.
    }
    return null
}

createServer(async (req, res) => {
    try {
        const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname
        let file = urlPath === '/' ? null : await resolveFile(urlPath)
        let servedPath = urlPath
        if (!file) {
            // Missing assets are real 404s; any other path is a client-side route.
            if (urlPath.startsWith('/assets/') || extname(urlPath)) {
                res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
                return
            }
            file = await resolveFile('/index.html')
            servedPath = '/index.html'
        }
        if (!file) {
            res.writeHead(500).end('Build missing')
            return
        }

        res.writeHead(200, {
            'content-type': TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream',
            'content-length': file.size,
            'cache-control': servedPath.startsWith('/assets/')
                ? 'public, max-age=31536000, immutable'
                : NO_CACHE.has(servedPath)
                  ? 'no-cache, no-store, must-revalidate'
                  : 'public, max-age=3600',
        })
        if (req.method === 'HEAD') res.end()
        else createReadStream(file.path).pipe(res)
    } catch {
        res.writeHead(500).end('Error')
    }
}).listen(PORT, () => console.log(`Serving dist/ on port ${PORT}`))
