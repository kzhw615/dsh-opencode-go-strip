/**
 * Plugin market index (`plugin-index.json`) guards.
 *
 * The real validator lives inside the DSH app, so this checks the rules that
 * actually bit us by hand: language ids are lowercase and include English, the
 * pinned commit is a full SHA, and the entry follows the manifest.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const read = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'))

const index = await read('plugin-index.json')
const manifest = await read('package.json')

const failures = []
function check(name, ok, detail) {
  if (!ok) failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const LANGUAGE = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/
const COMMIT = /^[0-9a-f]{40}$/

/** Localized text: a string, or a map keyed by lowercase language ids with English. */
function localized(value, path) {
  if (typeof value === 'string') return true
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    check(`${path} is localized text`, false, typeof value)
    return false
  }
  const keys = Object.keys(value)
  const bad = keys.filter((key) => !LANGUAGE.test(key))
  check(`${path} uses lowercase language ids`, bad.length === 0, bad.join(', '))
  check(`${path} includes en`, keys.includes('en'))
  return true
}

check('format is 1', index.format === 1, String(index.format))
localized(index.title, '$.title')
if (index.description !== undefined) localized(index.description, '$.description')
check('plugins is a non-empty array', Array.isArray(index.plugins) && index.plugins.length > 0)

const names = new Set()
for (const [position, plugin] of (index.plugins ?? []).entries()) {
  const at = `$.plugins[${position}]`
  check(`${at}.name is an npm package name`, typeof plugin.name === 'string' && PACKAGE_NAME.test(plugin.name), plugin.name)
  check(`${at}.name is unique`, !names.has(plugin.name))
  names.add(plugin.name)
  if (plugin.title !== undefined) localized(plugin.title, `${at}.title`)
  if (plugin.description !== undefined) localized(plugin.description, `${at}.description`)

  check(`${at} has versions`, Array.isArray(plugin.versions) && plugin.versions.length > 0)
  const seen = new Set()
  for (const [i, version] of (plugin.versions ?? []).entries()) {
    const at2 = `${at}.versions[${i}]`
    check(`${at2}.version is exact SemVer`, SEMVER.test(version.version ?? ''), version.version)
    check(`${at2}.version is unique`, !seen.has(version.version))
    seen.add(version.version)
    check(`${at2}.publishTimestamp is Unix seconds`, Number.isInteger(version.publishTimestamp) && version.publishTimestamp > 0 && version.publishTimestamp < 1e11)
    const source = version.source ?? {}
    check(`${at2}.source.type is npm or git`, source.type === 'npm' || source.type === 'git', source.type)
    if (source.type === 'git') {
      check(`${at2}.source.commit is a full SHA`, COMMIT.test(source.commit ?? ''), source.commit)
      check(`${at2}.source.url is an https repository`, /^https:\/\/[^/]+\/[^/]+\/[^/]+/.test(source.url ?? ''), source.url)
    }
    if (source.type === 'npm' && source.registry !== undefined) {
      check(`${at2}.source.registry is a URL`, /^https?:\/\//.test(source.registry), source.registry)
    }
    const engines = version.engines ?? {}
    if (engines.dsh !== undefined) {
      check(`${at2}.engines.dsh is a range, not a workspace range`, typeof engines.dsh === 'string' && !engines.dsh.startsWith('workspace:'), engines.dsh)
    }
  }

  if (plugin.icon !== undefined) {
    check(`${at}.icon is an accepted data URL or an https URL`, /^data:image\/(?:svg\+xml|png|jpeg|webp);base64,/.test(plugin.icon) || plugin.icon.startsWith('https:'))
    if (plugin.icon.startsWith('data:')) {
      const bytes = Buffer.from(plugin.icon.slice(plugin.icon.indexOf(',') + 1), 'base64').length
      check(`${at}.icon stays under 32 KiB`, bytes <= 32 * 1024, `${bytes} bytes`)
    }
  }
}

// The entry must describe this very package: a forgotten regeneration is the
// failure mode of a committed index.
const self = (index.plugins ?? []).find((plugin) => plugin.name === manifest.name)
check('the index lists this package', self !== undefined, manifest.name)
if (self !== undefined) {
  const newest = (self.versions ?? [])[0]
  check('the listed version matches package.json', newest?.version === manifest.version, `${newest?.version} vs ${manifest.version}`)
  check('the listed engines match package.json', JSON.stringify(newest?.engines ?? {}) === JSON.stringify(manifest.engines ?? {}))
  check('the repository matches package.json', (self.repository?.url ?? '').replace(/\.git$/, '') === manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''))
}

// A pinned git source must point at a commit this checkout actually contains:
// regenerating the index before committing the change points it at the wrong code.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
if (existsSync(new URL('../.git', import.meta.url))) {
  for (const plugin of index.plugins ?? []) {
    for (const version of plugin.versions ?? []) {
      if (version.source?.type !== 'git') continue
      let known = true
      try {
        execFileSync('git', ['cat-file', '-e', `${version.source.commit}^{commit}`], { cwd: repoRoot, stdio: 'ignore' })
      } catch {
        known = false
      }
      check('the pinned commit exists in this checkout', known, version.source.commit)
      if (known) {
        let complete = true
        try {
          execFileSync('git', ['merge-base', '--is-ancestor', version.source.commit, 'HEAD'], { cwd: repoRoot, stdio: 'ignore' })
        } catch {
          complete = false
        }
        check('the pinned commit is in this history', complete, version.source.commit)
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`${failures.length} index check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('index: format 1, localized text, pinned source and manifest agreement — all checks passed')
