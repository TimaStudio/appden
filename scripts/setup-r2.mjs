#!/usr/bin/env node
// ============================================================
// One-shot setup for the Cloudflare R2 media storage (see docs/R2_SETUP.md).
//
//   npm run storage:setup
//   npm run storage:setup -- --origins=https://tu-app.vercel.app,http://127.0.0.1:4173
//
// What it does (all from your machine, nothing is printed that is secret):
//   1. installs wrangler in r2-worker/ and logs you into Cloudflare if needed
//   2. creates the private bucket `appden-media` (skipped if it already exists)
//   3. copies VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env.local into r2-worker/wrangler.toml
//   4. generates SIGNING_SECRET + ADMIN_SECRET and stores them as Worker secrets
//   5. deploys the Worker and writes VITE_STORAGE_URL + STORAGE_ADMIN_SECRET to .env.local
// ============================================================

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workerDir = join(root, 'r2-worker')
const envPath = join(root, '.env.local')
const tomlPath = join(workerDir, 'wrangler.toml')
const isWindows = process.platform === 'win32'

const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
        const [key, ...rest] = arg.replace(/^--/, '').split('=')
        return [key, rest.join('=') || 'true']
    })
)

const log = (message) => console.log(`\n▸ ${message}`)
const fail = (message) => {
    console.error(`\n✖ ${message}`)
    process.exit(1)
}

function run(command, commandArgs, options = {}) {
    const result = spawnSync(command, commandArgs, {
        cwd: workerDir,
        encoding: 'utf8',
        shell: isWindows,
        stdio: options.inherit ? 'inherit' : 'pipe',
        input: options.input,
    })
    return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

const wrangler = (wranglerArgs, options) => run('npx', ['wrangler', ...wranglerArgs], options)

function readEnv() {
    if (!existsSync(envPath)) fail('No existe .env.local. Copia .env.example y rellena VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.')
    const map = new Map()
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (match) map.set(match[1], match[2].replace(/^["']|["']$/g, ''))
    }
    return map
}

function upsertEnv(entries) {
    let text = readFileSync(envPath, 'utf8')
    if (text.length > 0 && !text.endsWith('\n')) text += '\n'
    for (const [key, value] of Object.entries(entries)) {
        const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm')
        text = pattern.test(text) ? text.replace(pattern, `${key}=${value}`) : `${text}${key}=${value}\n`
    }
    writeFileSync(envPath, text)
}

function setTomlVar(toml, key, value) {
    const pattern = new RegExp(`^${key}\\s*=.*$`, 'm')
    const line = `${key} = "${value}"`
    return pattern.test(toml) ? toml.replace(pattern, line) : toml.replace('[vars]', `[vars]\n${line}`)
}

// ---------------------------------------------------------------- 0. inputs
const env = readEnv()
const supabaseUrl = env.get('VITE_SUPABASE_URL')
const anonKey = env.get('VITE_SUPABASE_ANON_KEY')
if (!supabaseUrl || !anonKey) fail('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env.local.')

// ---------------------------------------------------------------- 1. wrangler + login
log('Instalando wrangler (solo la primera vez)…')
if (!existsSync(join(workerDir, 'node_modules', 'wrangler'))) {
    if (!run('npm', ['install', '--no-audit', '--no-fund'], { inherit: true }).ok) fail('No se pudo instalar wrangler.')
}

log('Comprobando tu sesión de Cloudflare…')
if (!/You are logged in/i.test(wrangler(['whoami']).out)) {
    console.log('Se abrirá el navegador para que inicies sesión en Cloudflare.')
    if (!wrangler(['login'], { inherit: true }).ok) fail('No se pudo iniciar sesión en Cloudflare.')
}

// ---------------------------------------------------------------- 2. bucket
log('Creando el bucket privado appden-media…')
const bucket = wrangler(['r2', 'bucket', 'create', 'appden-media'])
if (!bucket.ok && !/already exists|10004/i.test(bucket.out)) {
    console.error(bucket.out)
    fail('No se pudo crear el bucket. ¿Tienes R2 activado en tu cuenta (Cloudflare pide una tarjeta, pero el plan gratuito no cobra)?')
}

// ---------------------------------------------------------------- 3. wrangler.toml
log('Configurando el Worker…')
let toml = readFileSync(tomlPath, 'utf8')
toml = setTomlVar(toml, 'SUPABASE_URL', supabaseUrl)
toml = setTomlVar(toml, 'SUPABASE_ANON_KEY', anonKey)
if (args.origins) toml = setTomlVar(toml, 'ALLOWED_ORIGINS', args.origins)
writeFileSync(tomlPath, toml)

// ---------------------------------------------------------------- 4. secrets
const signingSecret = randomBytes(32).toString('hex')
const adminSecret = env.get('STORAGE_ADMIN_SECRET') || randomBytes(32).toString('hex')
log('Guardando los secretos del Worker…')
for (const [name, value] of [
    ['SIGNING_SECRET', signingSecret],
    ['ADMIN_SECRET', adminSecret],
]) {
    if (!wrangler(['secret', 'put', name], { input: `${value}\n` }).ok) fail(`No se pudo guardar el secreto ${name}.`)
}

// ---------------------------------------------------------------- 5. deploy
log('Desplegando el Worker…')
const deploy = wrangler(['deploy'])
console.log(deploy.out.split('\n').filter((line) => !/secret|token/i.test(line)).join('\n'))
if (!deploy.ok) fail('Falló el despliegue.')

const workerUrl = deploy.out.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i)?.[0]
if (!workerUrl) fail('Desplegado, pero no pude leer la URL. Cópiala del panel de Cloudflare y ponla en VITE_STORAGE_URL.')

upsertEnv({ VITE_STORAGE_URL: workerUrl, STORAGE_ADMIN_SECRET: adminSecret })

console.log(`
✔ Listo. Worker en ${workerUrl}

Siguientes pasos:
  1. Vercel → Settings → Environment Variables → añade  VITE_STORAGE_URL=${workerUrl}  y vuelve a desplegar.
  2. Copia los archivos que ya existen en Supabase a R2 (añade SUPABASE_SERVICE_ROLE_KEY a .env.local):
       npm run storage:migrate:dry
       npm run storage:migrate
`)
