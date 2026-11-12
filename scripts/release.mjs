#!/usr/bin/env node
/**
 * Cut a release: bump the version, commit it, then publish the plugin-market index
 * that points at that commit, tag it and push.
 *
 * The order matters. The index names an exact commit, and an installed copy takes
 * its version from the manifest at that commit, so the index has to be regenerated
 * *after* the version bump is committed and committed separately.
 *
 * Usage:
 *   node scripts/release.mjs patch|minor|major [--dry-run]
 */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')
const kind = process.argv.slice(2).find((argument) => ['patch', 'minor', 'major'].includes(argument))

if (kind === undefined) {
  console.error('usage: node scripts/release.mjs patch|minor|major [--dry-run]')
  process.exit(1)
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' })
const manifestPath = join(root, 'package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

const [major, minor, patch] = manifest.version.split('-')[0].split('.').map((part) => Number.parseInt(part, 10))
const next = kind === 'major' ? `${major + 1}.0.0` : kind === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
const tag = `v${next}`

// A release starts from a committed tree, so the only thing in the version-bump
// commit is the version itself.
if (git('status', '--porcelain') !== '') {
  console.error('refusing to release with uncommitted changes; commit or stash them first')
  process.exit(1)
}
if (git('tag', '--list', tag) !== '') {
  console.error(`${tag} already exists`)
  process.exit(1)
}
console.log(`release ${manifest.version} -> ${next}${dryRun ? ' (dry run)' : ''}`)
if (dryRun) {
  console.log('would: bump, test, commit, regenerate plugin-index.json, commit, tag, push')
  process.exit(0)
}

manifest.version = next
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

// The code tests gate the release. The index test cannot run yet: the committed
// index still names the previous release, and the next one is generated below.
run('node', ['test/guards.test.mjs'])
run('node', ['test/host.test.mjs'])
run('node', ['test/client.test.mjs'])
git('add', 'package.json')
git('commit', '-m', `release: v${next}`)

// Now HEAD carries the new version, so the index may pin it.
run('node', ['scripts/build-index.mjs'])
// Now the index must agree with the bumped manifest, so it is checked before it
// is committed.
run('node', ['test/index.test.mjs'])
git('add', 'plugin-index.json')
git('commit', '-m', `release: pin the plugin-market index to v${next}`)
git('tag', '-a', tag, '-m', `v${next}`)
git('push', 'origin', 'main', '--follow-tags')
console.log(`\nreleased ${tag}; installed copies can update from the plugin panel.`)
