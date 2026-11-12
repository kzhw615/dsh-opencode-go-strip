/**
 * Host half, exercised through the HTTP route it registers.
 *
 * `fetch` is stubbed, so these run offline and never touch a real key.
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { apply } = await import(new URL('../index.js', import.meta.url).href)

const failures = []
function check(name, ok, detail) {
  if (!ok) failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const SECRET = 'test-key-0123456789'
const usageBody = {
  usage: {
    rolling: { status: 'ok', percent: 11.4, resetsAt: '2026-11-11T18:10:09.580Z' },
    weekly: { status: 'ok', percent: 71, resetsAt: '2026-11-15T00:00:00.580Z' },
    monthly: { status: 'rate-limited', percent: 93.2, resetsAt: '2026-12-01T00:00:00.580Z' },
  },
  plan: 'go',
}

let fetchCalls = 0
let fetchMode = 'ok'
const fakeFetch = async () => {
  fetchCalls += 1
  if (fetchMode === 'unauthorized') return new Response('{}', { status: 401 })
  if (fetchMode === 'not-json') return new Response('<html>nope</html>', { status: 200 })
  if (fetchMode === 'garbage') return new Response(JSON.stringify({ hello: 'world' }), { status: 200 })
  return new Response(JSON.stringify(usageBody), { status: 200 })
}

function makeHost({ credentials, admit = () => ({ peer: {} }), fetchImpl = fakeFetch } = {}) {
  const registered = []
  const ctx = {
    logger: { warn() {}, info() {}, error() {} },
    get(name) {
      if (name === 'webServer') {
        return {
          protocol: 'http:',
          port: 0,
          register(route) { registered.push(route); return () => {} },
        }
      }
      if (name === 'connection') return { admit }
      if (name === 'credentials') return credentials
      return undefined
    },
    on() { return () => {} },
    effect(callback) { const dispose = callback(); return () => { if (typeof dispose === 'function') dispose() } },
    inject(services, callback) {
      for (const service of services) if (ctx.get(service) === undefined) return
      callback({ get: (name) => ctx.get(name), effect: ctx.effect, on: ctx.on })
    },
  }
  globalThis.fetch = fetchImpl
  apply(ctx)
  return { route: registered[0] }
}

/** Call the registered node:http handler. */
async function call(host, path, { method = 'POST', body = '{}' } = {}) {
  const response = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead(status, extra) { response.status = status; Object.assign(response.headers, extra ?? {}) },
    end(chunk) { if (chunk !== undefined) response.body += chunk },
  }
  const req = {
    method,
    url: path,
    headers: { host: '127.0.0.1:0' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(body) },
  }
  await host.route.handler(req, res)
  let json
  try { json = JSON.parse(response.body) } catch { json = undefined }
  return { ...response, json }
}

const home = await mkdtemp(join(tmpdir(), 'ocg-test-'))
process.env.HOME = home
process.env.XDG_DATA_HOME = join(home, '.local', 'share')
process.env.OPENCODE_GO_API_KEY = SECRET

// ---- route shape and fences -------------------------------------------------
const host = makeHost()
check('registers one prefix route', host.route !== undefined && host.route.kind === 'prefix', String(host.route?.kind))
check('route path is the package channel', host.route?.path === '/opencode-go-usage', host.route?.path)

const denied = makeHost({ admit: () => ({ rejection: 401 }) })
check('unauthenticated call rejected', (await call(denied, '/opencode-go-usage/usage')).status === 401)
check('non-POST rejected', (await call(host, '/opencode-go-usage/usage', { method: 'GET' })).status === 405)
check('malformed body rejected', (await call(host, '/opencode-go-usage/usage', { body: '{oops' })).status === 400)
check('oversized body rejected', (await call(host, '/opencode-go-usage/usage', { body: JSON.stringify({ pad: 'x'.repeat(70_000) }) })).status === 400)

// ---- usage -----------------------------------------------------------------
const usage = await call(host, '/opencode-go-usage/usage')
check('usage answered', usage.status === 200 && usage.json?.ok === true, usage.body.slice(0, 120))
check('three windows in order', usage.json?.value?.windows?.map((w) => w.id).join(',') === 'rolling,weekly,monthly')
check('percent is clamped and kept', usage.json?.value?.windows?.[2]?.percent === 93.2)
check('the key never appears in the payload', !usage.body.includes(SECRET))
check('responses are no-store', usage.headers['cache-control'] === 'no-store')

const beforeCache = fetchCalls
await call(host, '/opencode-go-usage/usage')
check('repeat calls are cached', fetchCalls === beforeCache, `${beforeCache} -> ${fetchCalls}`)
await call(host, '/opencode-go-usage/refresh')
check('refresh bypasses the cache', fetchCalls === beforeCache + 1)

// ---- failure mapping -------------------------------------------------------
fetchMode = 'unauthorized'
check('401 maps to unauthorized', (await call(host, '/opencode-go-usage/refresh')).json?.error?.code === 'unauthorized')
fetchMode = 'garbage'
check('unknown payload reported', (await call(host, '/opencode-go-usage/refresh')).json?.error?.code === 'unexpected-payload')
fetchMode = 'not-json'
check('non-JSON body reported as payload problem', (await call(host, '/opencode-go-usage/refresh')).json?.error?.code === 'unexpected-payload')
fetchMode = 'ok'

// ---- windows[] variant ------------------------------------------------------
const arrayHost = makeHost({
  fetchImpl: async () => new Response(JSON.stringify({
    windows: [{ name: 'rolling-5h', percent: 5, resetsAt: null }, { name: 'weekly', percent: 20 }, { name: 'monthly', percent: 40, status: 'ok' }],
  }), { status: 200 }),
})
check('windows[] variant accepted', (await call(arrayHost, '/opencode-go-usage/usage')).json?.value?.windows?.length === 3)

// ---- endpoints --------------------------------------------------------------
check('unknown endpoint reported', (await call(host, '/opencode-go-usage/nope')).json?.error?.code === 'unknown-endpoint')
check('a path outside the channel has no endpoint', (await call(host, '/elsewhere/usage')).json?.error?.code === 'unknown-endpoint')

// ---- stored credential beats the environment --------------------------------
delete process.env.OPENCODE_GO_API_KEY
let stored
const store = {
  async readRecord() { return stored === undefined ? undefined : { kind: 'api-key', key: stored } },
  async describeRecord() { return { configured: stored !== undefined, writable: true } },
  async modifyRecord(_key, mutate) { const next = await mutate(undefined); stored = next.key; return next },
  async deleteRecord() { stored = undefined },
}
const storeHost = makeHost({ credentials: store })
check('missing key reported', (await call(storeHost, '/opencode-go-usage/usage')).json?.error?.code === 'no-key')

const saved = await call(storeHost, '/opencode-go-usage/setKey', { body: JSON.stringify({ key: `  ${SECRET}  ` }) })
check('setKey trims and stores', saved.json?.ok === true && stored === SECRET)
check('setKey masks the value', typeof saved.json?.value?.masked === 'string' && !saved.json.value.masked.includes(SECRET))
check('empty key rejected', (await call(storeHost, '/opencode-go-usage/setKey', { body: JSON.stringify({ key: '  ' }) })).json?.error?.code === 'invalid-key')

const described = await call(storeHost, '/opencode-go-usage/key')
check('key endpoint reports the stored source', described.json?.value?.source === 'stored' && described.json?.value?.configured === true)
check('key endpoint never returns the key', !described.body.includes(SECRET))
check('key endpoint advertises the session-only path', described.json?.value?.memoryOnly === true)
check('quota works after saving a key', (await call(storeHost, '/opencode-go-usage/usage')).json?.value?.keySource === 'stored')

// ---- session-only key -------------------------------------------------------
let stored2
const memoryStore = {
  async readRecord() { return stored2 === undefined ? undefined : { kind: 'api-key', key: stored2 } },
  async describeRecord() { return { configured: stored2 !== undefined, writable: true } },
  async modifyRecord(_key, mutate) { const next = await mutate(undefined); stored2 = next.key; return next },
  async deleteRecord() { stored2 = undefined },
}
const memoryHost = makeHost({ credentials: memoryStore })
const memorySave = await call(memoryHost, '/opencode-go-usage/setKey', { body: JSON.stringify({ key: SECRET, persist: false }) })
check('session-only save reports the memory source', memorySave.json?.value?.source === 'memory')
check('session-only save writes nothing', stored2 === undefined)
check('session-only key is used for queries', (await call(memoryHost, '/opencode-go-usage/usage')).json?.value?.keySource === 'memory')
check('clear removes it', (await call(memoryHost, '/opencode-go-usage/clearKey')).json?.ok === true)

// ---- auth.json fallback -----------------------------------------------------
const authDir = join(process.env.XDG_DATA_HOME, 'opencode')
await mkdir(authDir, { recursive: true })
await writeFile(join(authDir, 'auth.json'), JSON.stringify({ 'opencode-go': { type: 'api', key: SECRET } }))
const fileHost = makeHost()
const fromFile = await call(fileHost, '/opencode-go-usage/usage')
check('auth.json fallback works', fromFile.json?.ok === true && String(fromFile.json?.value?.keySource).endsWith('auth.json'))

// ---- profile without a credential store -------------------------------------
const bare = makeHost()
const bareKey = await call(bare, '/opencode-go-usage/key')
check('a store-less profile reports writable=false', bareKey.json?.value?.writable === false)
check('...but still allows a session-only key', bareKey.json?.value?.memoryOnly === true)

await rm(home, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`${failures.length} host check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('host: route, cache, error mapping, key sources — all checks passed')
