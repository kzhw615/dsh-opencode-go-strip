/**
 * OpenCode Go quota — Host half.
 *
 * Reads the Go subscription key from (in order) the plugin's stored credential
 * record, the launching environment, or the local OpenCode `auth.json`, queries
 * `https://opencode.ai/zen/go/v1/usage`, and serves one authenticated Connection
 * RPC channel so the browser half never holds the key.
 *
 * The endpoint returns percent-only windows; this plugin neither derives
 * dollar amounts nor invents limits.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const API_URL = 'https://opencode.ai/zen/go/v1/usage'
const CHANNEL = '/opencode-go-usage'
const KEY_RECORD = 'opencode-go-usage/api-key'
const ENV_NAMES = ['OPENCODE_GO_API_KEY', 'OPENCODE_ZEN_GO_API_KEY', 'OPENCODE_API_KEY']
const WINDOW_IDS = ['rolling', 'weekly', 'monthly']
const SUCCESS_TTL_MS = 60_000
const FAILURE_TTL_MS = 15_000
const REQUEST_TIMEOUT_MS = 20_000
const MAX_BODY_BYTES = 64 * 1024

const WINDOW_ALIASES = new Map([
  ['rolling', 'rolling'], ['rolling5h', 'rolling'], ['5h', 'rolling'], ['5hour', 'rolling'],
  ['weekly', 'weekly'], ['week', 'weekly'], ['7d', 'weekly'], ['7day', 'weekly'],
  ['monthly', 'monthly'], ['month', 'monthly'], ['30d', 'monthly'], ['30day', 'monthly'],
])

const ok = (value) => ({ ok: true, value })
const fail = (code, message, details = {}) => ({ ok: false, error: { code, message, details } })

/** Normalize an alias, falling back to its alphanumeric prefix match. */
function windowId(name) {
  if (typeof name !== 'string') return undefined
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const direct = WINDOW_ALIASES.get(compact)
  if (direct !== undefined) return direct
  for (const id of WINDOW_IDS) if (compact.startsWith(id)) return id
  return undefined
}

/** Read `percent`, `resetsAt`, and `status` from one window object, whatever its casing. */
function normalizeWindow(id, raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const percentRaw = raw.percent ?? raw.usagePercent ?? raw.percentUsed
  const percent = typeof percentRaw === 'number' ? percentRaw
    : typeof percentRaw === 'string' && percentRaw.trim() !== '' ? Number(percentRaw) : NaN
  if (!Number.isFinite(percent)) return undefined
  const resetsRaw = raw.resetsAt ?? raw.resetAt ?? raw.resets_at ?? raw.reset_at
  const resetsAt = typeof resetsRaw === 'string' && resetsRaw !== '' ? resetsRaw : null
  const status = typeof raw.status === 'string' ? raw.status : null
  return {
    id,
    percent: Math.max(0, Math.min(100, percent)),
    status,
    resetsAt,
  }
}

/**
 * Turn one usage payload into ordered windows.
 * Accepts the documented `{ usage: { rolling, weekly, monthly } }` shape and a
 * `{ windows: [{ name, percent, resetsAt }] }` variant.
 */
function normalizeUsage(body) {
  const found = new Map()
  const root = body !== null && typeof body === 'object' ? body : {}
  const usage = root.usage !== null && typeof root.usage === 'object' ? root.usage : root
  for (const id of WINDOW_IDS) {
    const window = normalizeWindow(id, usage[id])
    if (window !== undefined) found.set(id, window)
  }
  if (Array.isArray(root.windows)) {
    for (const entry of root.windows) {
      if (entry === null || typeof entry !== 'object') continue
      const id = windowId(entry.name ?? entry.window ?? entry.id)
      if (id === undefined || found.has(id)) continue
      const window = normalizeWindow(id, entry)
      if (window !== undefined) found.set(id, window)
    }
  }
  const windows = WINDOW_IDS.map((id) => found.get(id)).filter(Boolean)
  if (windows.length === 0) return undefined
  const plan = typeof root.plan === 'string' ? root.plan : undefined
  return { windows, plan }
}

/** Collect candidate `auth.json` sources, honoring the documented overrides. */
function authSources() {
  const sources = []
  const inline = process.env.OPENCODE_AUTH_CONTENT
  if (typeof inline === 'string' && inline.trim() !== '') sources.push({ label: 'OPENCODE_AUTH_CONTENT', content: inline })
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  sources.push({ label: join(dataHome, 'opencode', 'auth.json'), path: join(dataHome, 'opencode', 'auth.json') })
  sources.push({ label: join(homedir(), '.config', 'opencode', 'auth.json'), path: join(homedir(), '.config', 'opencode', 'auth.json') })
  return sources
}

/** Mask a key for display; the value itself never leaves the Host. */
function maskKey(key) {
  if (typeof key !== 'string' || key === '') return undefined
  if (key.length <= 8) return `${key.slice(0, 2)}…`
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

/**
 * Compose a cancellation signal carrying both the caller and the request deadline.
 * The deadline is tracked explicitly: an aborted fetch rejects with the abort
 * reason rather than an `AbortError`, so the reason cannot identify the cause.
 */
function deadlineSignal(signal) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('timeout'))
  }, REQUEST_TIMEOUT_MS)
  let bridge
  const done = () => {
    clearTimeout(timer)
    if (bridge !== undefined && signal !== undefined) signal.removeEventListener('abort', bridge)
  }
  const timedOutYet = () => timedOut
  if (typeof AbortSignal.any === 'function') {
    const parts = signal === undefined ? [controller.signal] : [signal, controller.signal]
    return { signal: AbortSignal.any(parts), done, timedOut: timedOutYet }
  }
  if (signal !== undefined) {
    bridge = () => { controller.abort(signal.reason) }
    signal.addEventListener('abort', bridge, { once: true })
  }
  return { signal: controller.signal, done, timedOut: timedOutYet }
}

export function apply(ctx) {
  const cache = { at: 0, result: undefined, inflight: undefined }
  /** A key this session only: never written to the credential store. */
  let memoryKey

  function logger(level, ...args) {
    // Logging is best-effort: a composition without the logger service must not
    // turn a diagnostic into an activation failure.
    try {
      const log = ctx.logger
      const emit = log?.[level]
      if (typeof emit === 'function') emit.call(log, ...args)
    } catch {
      // No logger available; the caller already returns a status the UI shows.
    }
  }

  async function storedKey() {
    const credentials = ctx.get('credentials')
    if (credentials === undefined || typeof credentials.readRecord !== 'function') return undefined
    try {
      const record = await credentials.readRecord(KEY_RECORD)
      const value = record !== null && typeof record === 'object' ? record.key : undefined
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    } catch (error) {
      logger('warn', 'opencode-go-usage: credential record read failed', error)
      return undefined
    }
  }

  async function authFileKey() {
    for (const source of authSources()) {
      let text
      if (source.content !== undefined) text = source.content
      else {
        try {
          text = await readFile(source.path, 'utf8')
        } catch {
          continue
        }
      }
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        logger('warn', `opencode-go-usage: ${source.label} is not valid JSON`)
        continue
      }
      if (parsed === null || typeof parsed !== 'object') continue
      const entry = parsed['opencode-go'] ?? parsed['opencode-zen'] ?? parsed.opencodeGo
      if (entry === null || typeof entry !== 'object') continue
      const value = entry.key ?? entry.access ?? entry.token
      if (typeof value === 'string' && value.trim() !== '') {
        return { key: value.trim(), source: source.label }
      }
    }
    return undefined
  }

  async function resolveKey() {
    if (memoryKey !== undefined) return { key: memoryKey, source: 'memory' }
    const record = await storedKey()
    if (record !== undefined) return { key: record, source: 'stored' }
    for (const name of ENV_NAMES) {
      const value = process.env[name]
      if (typeof value === 'string' && value.trim() !== '') return { key: value.trim(), source: name }
    }
    return authFileKey()
  }

  async function describeKey() {
    const resolved = await resolveKey()
    if (memoryKey !== undefined) {
      return { configured: true, source: 'memory', masked: maskKey(memoryKey), writable: true }
    }
    const credentials = ctx.get('credentials')
    let writable = false
    if (credentials !== undefined && typeof credentials.describeRecord === 'function') {
      try {
        const info = await credentials.describeRecord(KEY_RECORD)
        writable = info?.writable === true
      } catch {
        writable = false
      }
    }
    return {
      configured: resolved !== undefined,
      source: resolved?.source ?? null,
      masked: resolved === undefined ? null : maskKey(resolved.key),
      // `writable` describes the credential store only: a session-only key works
      // even when this profile has none, so the UI keeps that path open.
      writable,
      memoryOnly: true,
    }
  }

  async function requestUsage(key, signal) {
    const deadline = deadlineSignal(signal)
    const effective = deadline.signal
    try {
      const response = await fetch(API_URL, {
        method: 'GET',
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: effective,
      })
      if (response.status === 401 || response.status === 403) {
        return fail('unauthorized', 'The OpenCode Go API key was rejected (HTTP 401).')
      }
      if (response.status === 429) {
        return fail('rate-limited', 'OpenCode Go rate-limited this usage query (HTTP 429).')
      }
      if (!response.ok) {
        return fail('http', `OpenCode Go usage request failed with HTTP ${response.status}.`, { status: response.status })
      }
      let body
      try {
        body = await response.json()
      } catch {
        return fail('unexpected-payload', 'The OpenCode Go usage response was not JSON.')
      }
      const usage = normalizeUsage(body)
      if (usage === undefined) {
        return fail('unexpected-payload', 'The OpenCode Go usage response carried no recognizable quota windows.')
      }
      return ok({ ...usage, fetchedAt: new Date().toISOString() })
    } catch (error) {
      if (deadline.timedOut()) return fail('timeout', 'The OpenCode Go usage request timed out.')
      if (signal?.aborted === true) return fail('cancelled', 'The usage request was cancelled.')
      return fail('network', error instanceof Error ? error.message : String(error))
    } finally {
      deadline.done()
    }
  }

  async function loadUsage(force, signal) {
    const now = Date.now()
    if (force !== true && cache.result !== undefined) {
      const ttl = cache.result.ok === true ? SUCCESS_TTL_MS : FAILURE_TTL_MS
      if (now - cache.at < ttl) return cache.result
    }
    if (cache.inflight !== undefined) return cache.inflight
    const pending = (async () => {
      const resolved = await resolveKey()
      if (resolved === undefined) {
        return fail('no-key', 'No OpenCode Go API key is configured.', {})
      }
      const result = await requestUsage(resolved.key, signal)
      if (result.ok === true) result.value.keySource = resolved.source
      return result
    })()
    cache.inflight = pending
    try {
      const result = await pending
      // A caller that went away says nothing about the key or the service, so it
      // must not poison the next reader for the failure TTL.
      if (result.ok === true || result.error.code !== 'cancelled') {
        cache.result = result
        cache.at = Date.now()
      }
      return result
    } finally {
      cache.inflight = undefined
    }
  }

  async function setKey(payload) {
    const raw = payload !== null && typeof payload === 'object' ? payload.key : undefined
    const persist = payload !== null && typeof payload === 'object' ? payload.persist !== false : true
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value === '') return fail('invalid-key', 'The API key must be a non-empty string.')
    cache.result = undefined
    cache.at = 0
    if (persist !== true) {
      // Session-only: the value lives in this plugin's closure and dies with it.
      memoryKey = value
      return ok({ configured: true, masked: maskKey(value), source: 'memory', writable: true })
    }
    memoryKey = undefined
    const credentials = ctx.get('credentials')
    if (credentials === undefined || typeof credentials.modifyRecord !== 'function') {
      return fail('no-credential-store', 'This profile has no credential store; set OPENCODE_GO_API_KEY instead.')
    }
    try {
      await credentials.modifyRecord(KEY_RECORD, async () => ({ kind: 'api-key', key: value }))
    } catch (error) {
      return fail('save-failed', error instanceof Error ? error.message : String(error))
    }
    return ok({ configured: true, masked: maskKey(value), source: 'stored', writable: true })
  }

  async function clearKey() {
    memoryKey = undefined
    cache.result = undefined
    cache.at = 0
    const credentials = ctx.get('credentials')
    if (credentials === undefined || typeof credentials.deleteRecord !== 'function') {
      return fail('no-credential-store', 'This profile has no credential store.')
    }
    try {
      await credentials.deleteRecord(KEY_RECORD)
    } catch (error) {
      return fail('save-failed', error instanceof Error ? error.message : String(error))
    }
    cache.result = undefined
    cache.at = 0
    return ok(await describeKey())
  }

  async function dispatch(endpoint, payload, signal) {
    switch (endpoint) {
      case 'usage':
        return loadUsage(false, signal)
      case 'refresh':
        return loadUsage(true, signal)
      case 'key':
        return ok(await describeKey())
      case 'setKey':
        return setKey(payload)
      case 'clearKey':
        return clearKey()
      default:
        return fail('unknown-endpoint', `Unknown endpoint "${endpoint}".`)
    }
  }

  ctx.effect(() => ctx.on('credentials/record-updated', (key) => {
    if (key !== KEY_RECORD) return
    cache.result = undefined
    cache.at = 0
  }), 'opencode-go-usage: credential record changes')

  /**
   * One package-private JSON endpoint below the Host's own origin. The route is
   * mounted on `webServer` and admitted through `connection.admit()`, so only an
   * authenticated owner Peer (this page) can call it; the browser never receives
   * the key. `connection.rpc.handle()` would be the natural home for this, but in
   * this release it resolves `webServer` against the connection service's own
   * context, which does not inject it, so the call throws.
   */
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    const webServer = webCtx.get('webServer')
    const connection = webCtx.get('connection')
    if (webServer === undefined || connection === undefined) {
      logger('warn', 'opencode-go-usage: the web transport is unavailable; the quota strip cannot reach this Host.')
      return
    }

    async function respond(req, res) {
      const admission = connection.admit(req)
      if (admission.rejection !== undefined) {
        res.writeHead(admission.rejection)
        res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      let payload
      try {
        payload = await readJsonBody(req)
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(fail('bad-request', error instanceof Error ? error.message : String(error))))
        return
      }
      let result
      try {
        result = await dispatch(endpointOf(req.url), payload, undefined)
      } catch (error) {
        result = fail('internal', error instanceof Error ? error.message : String(error))
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(result))
    }

    try {
      webCtx.effect(
        () => webServer.register({ kind: 'prefix', path: CHANNEL, handler: respond }),
        `opencode-go-usage: ${CHANNEL} route`,
      )
    } catch (error) {
      logger('error', 'opencode-go-usage: could not register the quota route', error)
    }
  })
}

/** Endpoint name carried by `req.url` below the channel prefix. */
function endpointOf(rawUrl) {
  const path = (rawUrl ?? '').split('?', 1)[0] ?? ''
  if (!path.startsWith(`${CHANNEL}/`)) return ''
  return path.slice(CHANNEL.length + 1)
}

/** Read one small JSON body from a node:http request. */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  const parsed = JSON.parse(text)
  return parsed !== null && typeof parsed === 'object' ? parsed : {}
}
