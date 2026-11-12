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

// ------------------------------------------------------------ design system
check('no literal colours in the stylesheet', (css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length === 0)
check('no literal font sizes', (css.match(/font-size: \d+px/g) ?? []).length === 0)
const rawRadii = [...css.matchAll(/border-radius: (\d+)px/g)].map((m) => m[1]).filter((value) => value !== '999')
check('no literal container radii', rawRadii.length === 0, rawRadii.join(', '))
check('type comes from the host scale', css.includes('var(--dsw-font-xxs-12') && css.includes('var(--dsw-font-xs-strong-13'))
check('surfaces come from the host aliases', css.includes('var(--dsw-alias-bg-layer-3'))
check('labels stay dimmer than values', /\.ocg-pop-label \{[^}]*label-tertiary/.test(css) && /\.ocg-pop-value \{[^}]*label-primary/.test(css))

// --------------------------------------------------------------- behaviour
check('the key is never returned to the page', !/value\.key\b/.test(client) && host.includes('maskKey'))
// Quoted literals only, so the doc comment above the constant does not count.
check('exactly one outbound endpoint', (host.match(/'https?:\/\/[^']+'/g) ?? []).length === 1,
  (host.match(/'https?:\/\/[^']+'/g) ?? []).join(', '))
check('the plugin declares no agent tool', !/ctx\.tools/.test(host))
check('the plugin writes no session event', !/session\.append|appendPluginRecord/.test(host))
check('the popover is portaled, with an inline fallback', client.includes('createPortal') && client.includes('ocg-pop-inline'))
check('outside clicks close the popover', client.includes('pop.contains(event.target)'))
check('polling pauses on a hidden page', client.includes('document.hidden'))
check('the countdown clock stops while collapsed', client.includes('useClock(expanded ? CLOCK_MS : 0)'))
check('placement is throttled to one frame', client.includes('requestAnimationFrame'))
check('a session-only key survives a missing store', client.includes('forceMemory') && host.includes('memoryOnly: true'))
check('a non-JSON body is reported as a payload problem', host.includes("fail('unexpected-payload', 'The OpenCode Go usage response was not JSON.')"))

if (failures.length > 0) {
  console.error(`${failures.length} guard(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`guards: ${used.size} classes, ${css.length} bytes of CSS — all checks passed`)
