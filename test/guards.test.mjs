/**
 * Source-level guards.
 *
 * These exist because two regressions shipped during development without a
 * visible error: a stylesheet edit that deleted a whole block of strip styles,
 * and a token change that silently made one row unpainted. A browser test would
 * not catch either, but these invariants do.
 */
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const client = await readFile(new URL('client.js', root), 'utf8')
const host = await readFile(new URL('index.js', root), 'utf8')
const css = client.slice(client.indexOf('const CSS = `'), client.indexOf('\n`\n', client.indexOf('const CSS = `')))

const failures = []
function check(name, ok, detail) {
  if (!ok) failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

// ---------------------------------------------------------------- structure
for (const [file, source] of [['index.js', host], ['client.js', client]]) {
  check(`${file} parses as an ES module`, !/^\s*import .* from '\.\//m.test(source) || source.includes('export'))
  check(`${file} exports what the loader needs`, file === 'client.js'
    ? source.includes('window.__ModuleLoader__.load')
    : /export function apply\(ctx\)/.test(source))
}

// Every class the component renders must have a base rule. This is the check
// that would have caught the deleted `.ocg-summary` block.
const used = new Set()
for (const match of client.matchAll(/className: '([^']+)'/g)) {
  for (const token of match[1].split(' ')) if (token.startsWith('ocg-')) used.add(token)
}
const missing = [...used].filter((name) => !new RegExp(`\\n\\.${name} \\{`).test(css))
check('every rendered class has a base style rule', missing.length === 0, missing.join(', '))
check('stylesheet braces balance', (css.match(/\{/g) ?? []).length === (css.match(/\}/g) ?? []).length)

// --------------------------------------------------------------- i18n
// Both dictionaries must cover the same keys, and every literal lookup must
// exist in them: a missing key renders its own name on screen.
const grabDictionary = (marker) => {
  const from = client.indexOf(marker)
  const to = client.indexOf('\n    }', from)
  return new Set([...client.slice(from, to).matchAll(/'([a-z][a-zA-Z0-9.-]*)':/g)].map((m) => m[1]))
}
const en = grabDictionary('const EN = {')
const zh = grabDictionary('const ZH = {')
check('both dictionaries are non-trivial', en.size > 40 && zh.size > 40, `${en.size}/${zh.size}`)
check('dictionaries cover the same keys', en.size === zh.size && [...en].every((key) => zh.has(key)),
  [...en].filter((key) => !zh.has(key)).join(', '))
const lookups = new Set([...client.matchAll(/\bt\('([a-z][^']*)'/g)].map((m) => m[1]))
const unknownLookups = [...lookups].filter((key) => !en.has(key) && !key.startsWith('window.short.'))
check('every literal translation lookup exists', unknownLookups.length === 0, unknownLookups.join(', '))
const shortLookups = [...lookups].filter((key) => key.startsWith('window.short.'))
check('window.short keys exist', shortLookups.every((key) => en.has(key)), shortLookups.join(', '))

// ------------------------------------------------------------ design system
check('no literal colours in the stylesheet', (css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length === 0)
check('no literal font sizes', (css.match(/font-size: \d+px/g) ?? []).length === 0)
const rawRadii = [...css.matchAll(/border-radius: (\d+)px/g)].map((m) => m[1]).filter((value) => value !== '999')
check('no literal container radii', rawRadii.length === 0, rawRadii.join(', '))
// Hover must use the interactive aliases: bg-layer-* is pure white in the light
// theme, so a hover painted with it is invisible. This is how the strip ended up
// with no hover state at all.
const hoverRules = [...css.matchAll(/[^{}]*:hover[^{}]*\{[^}]*\}/g)].map((m) => m[0].replace(/\s+/g, ' '))
// A bg-layer-* fallback inside var(...) is fine; painting the hover *with* it is not.
const invisibleHover = hoverRules.filter((rule) => /background:\s*var\(--dsw-alias-bg-layer-/.test(rule))
check('hover backgrounds use the interactive aliases', invisibleHover.length === 0, invisibleHover.join(' | '))
check('the strip has a hover state', /\.ocg-summary:hover \{[^}]*interactive-bg-hover/.test(css.replace(/\n/g, ' ')))
check('the open popover keeps its trigger highlighted', css.includes('[data-expanded="true"] .ocg-summary'))
check('hover is gated on a pointing device', css.includes('@media (hover: hover)'))
check('pressing a control repaints it', (css.match(/:active \{[^}]*interactive-bg-active/g) ?? []).length >= 3)

check('type comes from the host scale', css.includes('var(--dsw-font-xxs-12') && css.includes('var(--dsw-font-xs-strong-13'))
check('surfaces come from the host aliases', css.includes('var(--dsw-alias-bg-layer-3'))
check('labels stay dimmer than values', /\.ocg-pop-label \{[^}]*label-tertiary/.test(css) && /\.ocg-pop-value \{[^}]*label-primary/.test(css))

// --------------------------------------------------------------- behaviour
check('the key is never returned to the page', !/value\.key\b/.test(client) && host.includes('maskKey'))
// Quoted literals only, so the doc comment above the constant does not count.
// Two endpoints are declared: the usage API, and this plugin's own release index.
const endpoints = [...new Set(host.match(/'https?:\/\/[^']+'/g) ?? [])]
check('exactly two outbound endpoints', endpoints.length === 2, endpoints.join(', '))
check('the usage endpoint is the OpenCode Go API', endpoints.some((url) => url.includes('opencode.ai/zen/go/v1/usage')))
check('the release index is this repository', endpoints.some((url) => url.includes('raw.githubusercontent.com/kzhw615/dsh-opencode-go-strip')))
check('the update check carries no credentials', !/UPDATE_INDEX_URL[\s\S]{0,400}authorization/i.test(host))
check('the plugin declares no agent tool', !/ctx\.tools/.test(host))
check('the plugin writes no session event', !/session\.append|appendPluginRecord/.test(host))
check('the popover is portaled, with an inline fallback', client.includes('createPortal') && client.includes('ocg-pop-inline'))
check('outside clicks close the popover', client.includes('pop.contains(event.target)'))
check('polling pauses on a hidden page', client.includes('document.hidden'))
check('the countdown clock stops while collapsed', client.includes('useClock(expanded ? CLOCK_MS : 0)'))
check('placement is throttled to one frame', client.includes('requestAnimationFrame'))
check('a session-only key survives a missing store', client.includes('forceMemory') && host.includes('memoryOnly: true'))
check('several keys live in one grant record', host.includes("kind: 'grant'") && host.includes('KEYS_RECORD'))
check('the previous single-key record is still read', host.includes('LEGACY_KEY_RECORD'))
check('switching keys invalidates the cache', host.includes('async function selectKey') && /async function selectKey[\s\S]{0,400}resetCache\(\)/.test(host))
check('the active key is cleared from the footer', client.includes("callHost('clearKey', keyInfo?.activeId"))
check('every listed key has a remove control', client.includes("className: 'ocg-menu-del'") && client.includes('async (id) =>'))
check('removal is a two-step action', client.includes('if (deletingId !== id)'))
check('the footer clear is labelled as removing the active key', client.includes('panel.clearKey'))
check('the strip draws the OpenCode mark', client.includes("d: 'M384 416H128V96H384V416ZM320 160H192V352H320V160Z'") && css.includes('.ocg-logo {'))
check('the mark follows the status tone', css.includes('.ocg-logo[data-tone="warn"]') && css.includes('.ocg-logo[data-tone="error"]'))
check('the strip draws no chevron', !client.includes('ocg-chevron') && !client.includes('▸'))
check('the header never wraps', /\.ocg-pop-head \{[^}]*flex-wrap: nowrap/.test(css.replace(/\n/g, ' ')))
check('the title never wraps', /\.ocg-pop-title \{[^}]*white-space: nowrap/.test(css.replace(/\n/g, ' ')))
check('one release slot beside the title', client.includes('update?.available === true') && client.includes(': typeof good?.fetchedAt === \'string\''))
check('the key row never wraps', /\.ocg-pop-foot \{[^}]*flex-wrap: nowrap/.test(css.replace(/\n/g, ' ')))
check('only the key name may truncate', /\.ocg-key-name \{[^}]*text-overflow: ellipsis/.test(css.replace(/\n/g, ' '))
  && /\.ocg-pop-key > \.ocg-hint/.test(css))
check('footer buttons keep their width', /\.ocg-btn \{[^}]*flex: 0 0 auto/.test(css.replace(/\n/g, ' ')))
check('the footer uses the short key prefix', client.includes("t('panel.keyShort')"))
check('the strip shows a hover tooltip', client.includes("className: 'ocg-tip'") && client.includes('onPointerEnter'))
check('the tooltip is dismissed when the strip moves', client.includes("window.addEventListener('scroll', clear, true)"))
check('a non-JSON body is reported as a payload problem', host.includes("fail('unexpected-payload', 'The OpenCode Go usage response was not JSON.')"))

if (failures.length > 0) {
  console.error(`${failures.length} guard(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`guards: ${used.size} classes, ${css.length} bytes of CSS — all checks passed`)
