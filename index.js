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
const UPDATE_INDEX_URL = 'https://raw.githubusercontent.com/kzhw615/dsh-opencode-go-strip/main/plugin-index.json'
const UPDATE_TTL_MS = 10 * 60_000
const UPDATE_TIMEOUT_MS = 15_000
const KEYS_RECORD = 'opencode-go-usage/keys'
const LEGACY_KEY_RECORD = 'opencode-go-usage/api-key'
const SESSION_ID = 'session'
const LEGACY_ITEM_ID = 'saved'
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

  function credentialStore() {
    const credentials = ctx.get('credentials')
    return credentials === undefined ? undefined : credentials
  }

  function resetCache() {
    cache.result = undefined
    cache.at = 0
  }

  /** The environment variable that currently supplies a key, if any. */
  function envKey() {
    for (const name of ENV_NAMES) {
      const value = process.env[name]
      if (typeof value === 'string' && value.trim() !== '') return { key: value.trim(), source: name }
    }
    return undefined
  }

  /** The single-key record written by earlier versions of this plugin. */
  async function legacyKey() {
    const credentials = credentialStore()
    if (credentials === undefined || typeof credentials.readRecord !== 'function') return undefined
    try {
      const record = await credentials.readRecord(LEGACY_KEY_RECORD)
      const value = record !== null && typeof record === 'object' ? record.key : undefined
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    } catch (error) {
      logger('warn', 'opencode-go-usage: legacy credential record read failed', error)
      return undefined
    }
  }

  /**
   * Saved keys plus the active id. Both live in one grant record because the
   * credential seam addresses an api-key record by a single value, while a list
   * needs ids, labels and an active pointer that only this plugin understands.
   */
  async function readKeyState() {
    const credentials = credentialStore()
    const state = { stored: [], activeId: null, writable: false }
    if (credentials === undefined) return state
    if (typeof credentials.describeRecord === 'function') {
      try {
        state.writable = (await credentials.describeRecord(KEYS_RECORD))?.writable === true
      } catch {
        state.writable = false
      }
    }
    if (typeof credentials.readRecord === 'function') {
      try {
        const record = await credentials.readRecord(KEYS_RECORD)
        const payload = record !== null && typeof record === 'object' && record.kind === 'grant' ? record.payload : undefined
        if (payload !== null && typeof payload === 'object' && Array.isArray(payload.items)) {
          state.stored = payload.items
            .filter((item) => item !== null && typeof item === 'object'
              && typeof item.id === 'string' && item.id !== ''
              && typeof item.key === 'string' && item.key.trim() !== '')
            .map((item) => ({
              id: item.id,
              label: typeof item.label === 'string' && item.label !== '' ? item.label : item.id,
              key: item.key,
            }))
          if (typeof payload.active === 'string' && state.stored.some((item) => item.id === payload.active)) {
            state.activeId = payload.active
          }
        }
      } catch (error) {
        logger('warn', 'opencode-go-usage: credential record read failed', error)
      }
    }
    if (state.stored.length === 0) {
      // Adopt a key saved by an earlier version, without deleting it yet.
      const legacy = await legacyKey()
      if (legacy !== undefined) {
        state.stored = [{ id: LEGACY_ITEM_ID, label: 'Saved key', key: legacy }]
        state.activeId = LEGACY_ITEM_ID
      }
    }
    if (state.activeId === null && state.stored.length > 0) state.activeId = state.stored[0].id
    return state
  }

  /** Persist the list. Returns a failure code instead of throwing. */
  async function writeKeyState(items, activeId) {
    const credentials = credentialStore()
    if (credentials === undefined || typeof credentials.modifyRecord !== 'function') return 'no-credential-store'
    try {
      await credentials.modifyRecord(KEYS_RECORD, async () => ({
        kind: 'grant',
        payload: { active: activeId, items: items.map(({ id, label, key }) => ({ id, label, key })) },
      }))
    } catch (error) {
      logger('error', 'opencode-go-usage: could not save the key list', error)
      return 'save-failed'
    }
    return undefined
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
    const state = await readKeyState()
    const active = state.stored.find((item) => item.id === state.activeId)
    if (active !== undefined) return { key: active.key, source: 'stored' }
    const env = envKey()
    if (env !== undefined) return env
    return authFileKey()
  }

  async function describeKey() {
    const state = await readKeyState()
    const active = state.stored.find((item) => item.id === state.activeId)
    const items = state.stored.map((item) => ({ id: item.id, label: item.label, masked: maskKey(item.key) }))
    if (memoryKey !== undefined) {
      items.unshift({ id: SESSION_ID, label: 'This session', masked: maskKey(memoryKey) })
    }
    let fallback = null
    if (memoryKey === undefined && active === undefined) {
      const env = envKey()
      if (env !== undefined) {
        fallback = { source: env.source, masked: maskKey(env.key) }
      } else {
        const file = await authFileKey()
        if (file !== undefined) fallback = { source: file.source, masked: maskKey(file.key) }
      }
    }
    const masked = memoryKey !== undefined
      ? maskKey(memoryKey)
      : active !== undefined ? maskKey(active.key) : (fallback?.masked ?? null)
    return {
      configured: masked !== null,
      source: memoryKey !== undefined ? 'memory' : active !== undefined ? 'stored' : (fallback?.source ?? null),
      masked,
      // `writable` describes the credential store only: a session-only key works
      // even when this profile has none, so the UI keeps that path open.
      writable: state.writable,
      memoryOnly: true,
      activeId: memoryKey !== undefined ? SESSION_ID : (active?.id ?? null),
      items,
      fallback,
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

  /** The version this copy runs, read from the manifest beside this module. */
  let manifestPromise
  function ownManifest() {
    manifestPromise ??= readFile(new URL('./package.json', import.meta.url), 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => undefined)
    return manifestPromise
  }

  /**
   * What the published index names. It is the release channel: each entry pins the
   * commit that carries that version, which is exactly what `updateBundle` takes.
   */
  async function latestRelease(signal) {
    if (cache.update !== undefined && Date.now() - cache.updateAt < UPDATE_TTL_MS) return cache.update
    const deadline = deadlineSignal(signal)
    try {
      const response = await fetch(UPDATE_INDEX_URL, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: deadline.signal,
      })
      if (!response.ok) return undefined
      const body = await response.json()
      const entry = Array.isArray(body?.plugins) ? body.plugins[0] : undefined
      const version = Array.isArray(entry?.versions) ? entry.versions[0] : undefined
      if (version === undefined || typeof version.version !== 'string') return undefined
      const result = {
        version: version.version,
        commit: version.source?.type === 'git' ? version.source.commit : undefined,
        url: version.source?.type === 'git' ? version.source.url : undefined,
      }
      cache.update = result
      cache.updateAt = Date.now()
      return result
    } catch {
      return undefined
    } finally {
      deadline.done()
    }
  }

  function compareVersions(left, right) {
    const parse = (value) => String(value).split('-')[0].split('.').map((part) => Number.parseInt(part, 10) || 0)
    const a = parse(left)
    const b = parse(right)
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const diff = (a[index] ?? 0) - (b[index] ?? 0)
      if (diff !== 0) return diff
    }
    return String(left) === String(right) ? 0 : String(left).localeCompare(String(right))
  }

  /**
   * Whether this copy can be replaced in place. Only a Git-installed bundle is
   * updatable: a local directory is the user's own checkout, and the manager
   * refuses a registry target that is not on a registry.
   */
  async function updateState() {
    const manifest = await ownManifest()
    const latest = await latestRelease()
    let current = typeof manifest?.version === 'string' ? manifest.version : undefined
    let entry
    const manager = ctx.get('pluginManager')
    if (manager !== undefined && typeof manager.listBundles === 'function') {
      try {
        const bundles = await manager.listBundles()
        entry = bundles.find((bundle) => bundle.name === (manifest?.name ?? entry?.name))
      } catch {
        entry = undefined
      }
    }
    // The manager knows the installed version without reading this module, so it
    // is the more reliable source when it is available.
    if (typeof entry?.version === 'string') current = entry.version
    const state = {
      current: current ?? null,
      latest: latest?.version ?? null,
      // An unknown current version still lets a release be reported.
      available: current === undefined || latest === undefined ? null : compareVersions(latest.version, current) > 0,
      canApply: false,
      reason: 'unsupported',
    }
    if (state.available !== true) {
      state.reason = latest === undefined ? 'unreachable' : 'current'
      return state
    }
    if (manager === undefined || typeof manager.updateBundle !== 'function') {
      state.reason = 'no-manager'
      return state
    }
    if (entry === undefined) {
      state.reason = 'unknown-bundle'
      return state
    }
    if (entry.update !== 'git') {
      // A checkout, or a copy pnpm installed from a registry.
      state.reason = 'not-git'
      return state
    }
    state.canApply = true
    state.reason = 'ready'
    state.spec = `git+${latest.url}#${latest.commit}`
    return state
  }

  async function applyUpdate() {
    const state = await updateState()
    if (state.canApply !== true) return ok(state)
    const manager = ctx.get('pluginManager')
    const manifest = await ownManifest()
    // The manager removes this bundle first, so this plugin unloads mid-call: the
    // answer is the acknowledgement, and the page watches for the new version.
    try {
      const pending = manager.updateBundle(manifest.name, state.latest, { spec: state.spec })
      pending?.catch?.(() => {})
    } catch (error) {
      return fail('update-failed', error instanceof Error ? error.message : String(error))
    }
    return ok({ ...state, started: true })
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
    const value = payload !== null && typeof payload === 'object' && typeof payload.key === 'string' ? payload.key.trim() : ''
    const persist = payload !== null && typeof payload === 'object' ? payload.persist !== false : true
    const label = payload !== null && typeof payload === 'object' && typeof payload.label === 'string' ? payload.label.trim() : ''
    const target = payload !== null && typeof payload === 'object' && typeof payload.id === 'string' ? payload.id : undefined
    if (value === '') return fail('invalid-key', 'The API key must be a non-empty string.')
    resetCache()
    if (persist !== true) {
      // Session-only: the value lives in this plugin's closure and dies with it.
      memoryKey = value
      return ok(await describeKey())
    }
    const state = await readKeyState()
    const items = state.stored.slice()
    const existing = target === undefined ? undefined : items.find((item) => item.id === target)
    let activeId
    if (existing !== undefined) {
      existing.key = value
      if (label !== '') existing.label = label
      activeId = existing.id
    } else {
      let index = items.length + 1
      while (items.some((item) => item.id === `key-${index}`)) index += 1
      activeId = `key-${index}`
      items.push({ id: activeId, label: label !== '' ? label : `Key ${index}`, key: value })
    }
    const failure = await writeKeyState(items, activeId)
    if (failure !== undefined) return fail(failure, 'The key could not be saved.')
    memoryKey = undefined
    return ok(await describeKey())
  }

  async function selectKey(payload) {
    const id = payload !== null && typeof payload === 'object' && typeof payload.id === 'string' ? payload.id : ''
    if (id === '') return fail('invalid-key', 'A key id is required.')
    resetCache()
    if (id === SESSION_ID) {
      if (memoryKey === undefined) return fail('no-key', 'This session has no key to select.')
      return ok(await describeKey())
    }
    const state = await readKeyState()
    if (!state.stored.some((item) => item.id === id)) return fail('unknown-key', 'That key is no longer saved.')
    memoryKey = undefined
    const failure = await writeKeyState(state.stored, id)
    if (failure !== undefined) return fail(failure, 'The active key could not be saved.')
    return ok(await describeKey())
  }

  async function clearKey(payload) {
    const id = payload !== null && typeof payload === 'object' && typeof payload.id === 'string' ? payload.id : undefined
    resetCache()
    if (id === SESSION_ID) {
      memoryKey = undefined
      return ok(await describeKey())
    }
    const credentials = credentialStore()
    if (id === undefined) {
      memoryKey = undefined
      if (credentials !== undefined && typeof credentials.deleteRecord === 'function') {
        try {
          await credentials.deleteRecord(KEYS_RECORD)
          await credentials.deleteRecord(LEGACY_KEY_RECORD)
        } catch (error) {
          return fail('save-failed', error instanceof Error ? error.message : String(error))
        }
      }
      return ok(await describeKey())
    }
    const state = await readKeyState()
    const items = state.stored.filter((item) => item.id !== id)
    if (items.length === state.stored.length) return fail('unknown-key', 'That key is not saved.')
    const activeId = state.activeId === id ? (items[0]?.id ?? null) : state.activeId
    const failure = await writeKeyState(items, activeId)
    if (failure !== undefined) return fail(failure, 'The key could not be removed.')
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
        return clearKey(payload)
      case 'selectKey':
        return selectKey(payload)
      case 'update':
        return payload !== null && typeof payload === 'object' && payload.action === 'apply'
          ? applyUpdate()
          : ok(await updateState())
      default:
        return fail('unknown-endpoint', `Unknown endpoint "${endpoint}".`)
    }
  }

  ctx.effect(() => ctx.on('credentials/record-updated', (key) => {
    if (key !== KEYS_RECORD && key !== LEGACY_KEY_RECORD) return
    resetCache()
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
