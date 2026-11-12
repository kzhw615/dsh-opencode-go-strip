/**
 * Browser half, rendered with a minimal React shim.
 *
 * There is no DOM here: the point is to catch crashes, broken slots and wrong
 * text or tokens in every state, not to verify pixels. A real page is still the
 * only way to judge how it looks.
 */
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

const failures = []
function check(name, ok, detail) {
  if (!ok) failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

globalThis.document = {
  body: { nodeType: 1 },
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
}

const baseReact = {
  createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  useEffect() {},
  useSyncExternalStore(subscribe, getSnapshot) { subscribe(() => {}); return getSnapshot() },
  useRef(value) { return { current: value } },
}
const reactDom = { createPortal: (node, container) => ({ type: 'portal', props: { container }, children: [node] }) }

const dictionary = {}
const locale = {
  register(ns, id, entries) { Object.assign(dictionary, entries); return () => {} },
  bind() {
    return (key, params) => {
      const template = dictionary[key] ?? key
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }
  },
  subscribe() { return () => {} },
  getSnapshot() { return { active: 'zh', locales: [], revision: 1 } },
}

function walk(node, visit) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return }
  if (typeof node !== 'object') return
  visit(node)
  walk(node.children, visit)
}
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node !== 'object') return ''
  if (node.type === 'style') return ''
  return textOf(node.children ?? node.props?.children)
}
const findAll = (node, predicate, out = []) => { walk(node, (candidate) => { if (predicate(candidate)) out.push(candidate) }); return out }

/**
 * Render one state. `useStateAt` overrides the initial value of a hook slot:
 * 0 snapshot, 1 expanded, 3 key info, 9 placement, 10 label draft, 11 key menu,
 * 12 hover tooltip, 13 armed delete, 14 update state (15 is the countdown clock).
 */
function render({ useStateAt = {}, lastGood } = {}) {
  let stateIndex = 0
  let refIndex = 0
  const React = {
    ...baseReact,
    useState(initial) {
      const index = stateIndex++
      return [useStateAt[index] !== undefined ? useStateAt[index] : (typeof initial === 'function' ? initial() : initial), () => {}]
    },
    useRef(value) { const index = refIndex++; return { current: index === 0 ? lastGood : value } },
  }
  let definition
  const fakeWindow = { __ModuleLoader__: { load(def) { definition = def } } }
  const requireShim = (name) => (name === 'react-dom' ? reactDom : React)
  new Function('window', 'React', 'require', `${source}\nreturn window.__ModuleLoader__;`)(fakeWindow, React, requireShim)
  const plugin = definition.factory(requireShim)
  const registrations = []
  plugin.apply({
    get: (name) => (name === 'locale' ? locale : undefined),
    on: () => () => {},
    effect: (callback) => callback(),
    slots: {
      inject(owner, callback) { registrations.push({ owner }); callback() },
      register(options, component) { registrations.push({ options, component }); return () => {} },
    },
  })
  const slot = registrations.find((entry) => entry.owner !== undefined)?.owner
  const options = registrations.find((entry) => entry.options !== undefined)?.options
  const component = registrations.find((entry) => entry.options !== undefined)?.component
  const element = component({})
  const card = element.children?.find((child) => child?.type === 'portal')?.children?.[0]
  return { slot, options, element, card }
}

const storedKey = {
  configured: true,
  source: 'stored',
  masked: 'oc_s…bals',
  writable: true,
  memoryOnly: true,
  activeId: 'key-1',
  items: [{ id: 'key-1', label: 'Key 1', masked: 'oc_s…bals' }],
  fallback: null,
}
const twoKeys = {
  ...storedKey,
  activeId: 'key-2',
  masked: 'second…3210',
  items: [
    { id: 'key-1', label: 'Personal', masked: 'oc_s…bals' },
    { id: 'key-2', label: 'Work', masked: 'second…3210' },
  ],
}
const iso = (ms) => new Date(Date.now() + ms).toISOString()
const readyValue = {
  windows: [
    { id: 'rolling', percent: 6, status: 'ok', resetsAt: iso(3_600_000) },
    { id: 'weekly', percent: 2, status: 'ok', resetsAt: iso(2 * 86_400_000) },
    { id: 'monthly', percent: 1, status: 'ok', resetsAt: iso(12 * 86_400_000) },
  ],
  fetchedAt: new Date().toISOString(),
  keySource: 'stored',
}
const placement = { left: 120, bottom: 220, width: 300 }

// ---- module + slot ---------------------------------------------------------
const collapsed = render()
check('registers into the composer dock', collapsed.slot === 'conversation.composer.dock', String(collapsed.slot))
check('registers with a stable id', collapsed.options?.id === 'opencode-go-usage')
check('collapsed strip renders alone', collapsed.element.props['data-expanded'] === false && collapsed.card === undefined)
check('collapsed strip shows the loading copy', textOf(collapsed.element).includes('正在读取额度'))
check('the strip advertises a dialog', collapsed.element.children?.some((child) => child?.props?.['aria-haspopup'] === 'dialog'))

// ---- expanded --------------------------------------------------------------
const expanded = render({ useStateAt: { 0: { status: 'ready', value: readyValue }, 1: true, 3: storedKey, 9: placement } })
const cardText = textOf(expanded.card)
check('the popover is portaled', expanded.card?.props?.className === 'ocg-pop', String(expanded.card?.props?.className))
check('the popover is positioned from the anchor', JSON.stringify(expanded.card?.props?.style) === JSON.stringify(placement))
check('the header has no quota headline', cardText.includes('OpenCode Go 额度') && !cardText.includes('已用 6%'), cardText.slice(0, 80))
check('the header carries the update stamp', /更新于/.test(cardText), cardText.slice(0, 120))
check('three window rows render', findAll(expanded.card, (node) => node.props?.className === 'ocg-pop-row').length === 3)
check('every row draws a ring', findAll(expanded.card, (node) => node.props?.className === 'ocg-ring').length === 3)
check('rings are decorative for assistive tech', findAll(expanded.card, (node) => node.props?.className === 'ocg-ring').every((node) => node.props['aria-hidden'] === 'true'))
check('rows show the used percentage', cardText.includes('6%') && cardText.includes('2%') && cardText.includes('1%'))
check('rows show the reset countdown', cardText.includes('后重置'))
check('the footer shows the key mask', cardText.includes('oc_s…bals'))
check('the footer offers clear and change', cardText.includes('清除') && cardText.includes('更换'))

// ---- key management --------------------------------------------------------
const noKey = render({ useStateAt: { 0: { status: 'error', code: 'no-key' }, 1: true, 3: { configured: false, source: null, masked: null, writable: true, memoryOnly: true }, 9: placement } })
check('the key form opens without a key', findAll(noKey.card, (node) => node.type === 'input' && node.props?.type === 'password').length === 1)
check('the session-only option is offered', textOf(noKey.card).includes('仅本次会话使用'))

const storeless = render({ useStateAt: { 0: { status: 'error', code: 'no-key' }, 1: true, 3: { configured: false, source: null, masked: null, writable: false, memoryOnly: true }, 9: placement } })
check('a store-less profile still offers the form', findAll(storeless.card, (node) => node.type === 'input' && node.props?.type === 'password').length === 1)
check('...without the persist checkbox', findAll(storeless.card, (node) => node.type === 'input' && node.props?.type === 'checkbox').length === 0)
check('...and explains why', textOf(storeless.card).includes('OPENCODE_GO_API_KEY'))

// ---- degraded states -------------------------------------------------------
const stale = render({ useStateAt: { 0: { status: 'error', code: 'network' }, 1: true, 3: storedKey, 9: placement }, lastGood: readyValue })
check('a failed poll keeps the last good numbers', textOf(stale.card).includes('6%'))
check('a failed poll is marked', textOf(stale.card).includes('上次刷新失败'))

const partial = render({ useStateAt: { 0: { status: 'ready', value: { windows: [{ id: 'weekly', percent: 44, status: 'rate-limited', resetsAt: null }], fetchedAt: new Date().toISOString() } }, 1: true, 3: storedKey, 9: placement } })
check('a missing window is labelled', textOf(partial.card).includes('未返回数据'))
check('a non-ok window status is surfaced', textOf(partial.card).includes('已限流'))

// ---- several keys -----------------------------------------------------------
const keyList = render({ useStateAt: { 0: { status: 'ready', value: readyValue }, 1: true, 3: twoKeys, 9: placement } })
check('the active key label is shown', textOf(keyList.card).includes('Work'), textOf(keyList.card).slice(0, 120))
check('the picker is closed by default', findAll(keyList.card, (node) => node.props?.className === 'ocg-menu').length === 0)
check('the footer offers a picker toggle',
  findAll(keyList.card, (node) => node.props?.['aria-label'] === '已保存的 Key').length >= 1)

const keyMenu = render({ useStateAt: { 0: { status: 'ready', value: readyValue }, 1: true, 3: twoKeys, 9: placement, 11: true } })
const menuRows = findAll(keyMenu.card, (node) => node.props?.className === 'ocg-menu-row')
check('the picker lists every key', menuRows.length === 2, `${menuRows.length} rows`)
check('the active key is marked', menuRows.filter((node) => node.props['aria-selected'] === true).length === 1)
const removeButtons = findAll(keyMenu.card, (node) => node.props?.className === 'ocg-menu-del')
check('every listed key can be removed', removeButtons.length === 2, `${removeButtons.length} buttons`)
check('removal is labelled for assistive tech',
  removeButtons.every((node) => typeof node.props['aria-label'] === 'string' && node.props['aria-label'].includes('删除')))
check('removal needs a second press', removeButtons.every((node) => node.props['data-armed'] === 'false' && node.children?.[0] === '×'))

const armed = render({ useStateAt: { 0: { status: 'ready', value: readyValue }, 1: true, 3: twoKeys, 9: placement, 11: true, 13: 'key-1' } })
const armedButton = findAll(armed.card, (node) => node.props?.['data-armed'] === 'true')
check('the armed button asks for confirmation', armedButton.length === 1 && textOf(armedButton[0]).includes('确认'))
check('the picker offers adding a key', textOf(keyMenu.card).includes('添加新 Key'))
check('each entry shows its mask', textOf(keyMenu.card).includes('Personal') && textOf(keyMenu.card).includes('second…3210'))

// ---- hover tooltip ----------------------------------------------------------
const hovered = render({ useStateAt: { 0: { status: 'ready', value: readyValue }, 12: { id: 'weekly', left: 80, bottom: 240, width: 210 } } })
const tip = findAll(hovered.element, (node) => node.props?.className === 'ocg-tip')[0]
check('hovering a window opens a tooltip', tip !== undefined)
check('the tooltip names the window', textOf(tip).includes('本周'), textOf(tip))
check('the tooltip shows used and remaining', textOf(tip).includes('已用') && textOf(tip).includes('剩余'))
check('the tooltip is anchored above the strip', tip?.props?.style?.bottom === 240 && tip?.props?.style?.position === 'fixed')
check('the tooltip is a tooltip for assistive tech', tip?.props?.role === 'tooltip')

// ---- release channel --------------------------------------------------------
const upToDate = render({ useStateAt: { 0: { status: 'ready', value: readyValue }, 1: true, 3: storedKey, 9: placement, 14: { current: '1.0.0', latest: '1.0.0', available: false, canApply: false, reason: 'current' } } })
check('an up-to-date copy shows no update control', findAll(upToDate.card, (node) => node.props?.className === 'ocg-update').length === 0)
check('the running version is shown', textOf(upToDate.card).includes('v1.0.0'), textOf(upToDate.card).slice(0, 90))

const offered = render({ useStateAt: { 0: { status: 'ready', value: readyValue }, 1: true, 3: storedKey, 9: placement, 14: { current: '1.0.0', latest: '1.2.0', available: true, canApply: true, reason: 'ready', spec: 'git+https://example.invalid#abc' } } })
const updateButton = findAll(offered.card, (node) => node.props?.className === 'ocg-update')[0]
check('a newer release offers an update control', updateButton !== undefined)
check('the control names the version', textOf(updateButton).includes('1.2.0'), textOf(updateButton))
check('the control explains itself', typeof updateButton?.props?.title === 'string' && updateButton.props.title.includes('1.2.0'))

const starting = render({ useStateAt: { 0: { status: 'ready', value: readyValue }, 1: true, 3: storedKey, 9: placement, 14: { current: '1.0.0', latest: '1.2.0', available: true, canApply: true, started: true } } })
const busyButton = findAll(starting.card, (node) => node.props?.className === 'ocg-update')[0]
check('an update in progress is disabled', busyButton?.props?.disabled === true)
check('an update in progress says so', textOf(busyButton).includes('正在更新'), textOf(busyButton))

if (failures.length > 0) {
  console.error(`${failures.length} client check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('client: slot, popover, key forms and degraded states — all checks passed')
