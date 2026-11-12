#!/usr/bin/env node
/**
 * Write `plugin-index.json`, a plugin market index (format 1).
 *
 * Two sources are possible. `--npm` names the published package, so the entry
 * follows every release. The default pins this checkout's HEAD as a git source,
 * which works before the first publish but has to be regenerated whenever the
 * bundle changes.
 *
 * Usage:
 *   node scripts/build-index.mjs          # git source pinned to HEAD
 *   node scripts/build-index.mjs --npm    # published package
 */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'))

const manifest = await read('package.json')
const en = (await read('locale/en.json')).meta
const zh = (await read('locale/zh.json')).meta
const icon = (await readFile(join(root, 'icon.svg'), 'utf8')).trim()
const useNpm = process.argv.includes('--npm')

const repoUrl = manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const publishedAt = Math.floor(
  useNpm
    ? Date.parse(manifest.publishTimestamp ?? new Date().toISOString()) / 1000
    : Number(execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: root, encoding: 'utf8' }).trim()),
)

const index = {
  format: 1,
  title: { en: 'DeepSeek Harness plugins', 'zh-hans': 'DeepSeek Harness 插件' },
  description: {
    en: 'Small bundles that extend the DeepSeek Harness interface.',
    'zh-hans': '给 DeepSeek Harness 界面加功能的独立 bundle。',
  },
  metadata: {
    categories: { interface: { title: { en: 'Interface', 'zh-hans': '界面' } } },
    labels: { composer: { title: { en: 'Composer', 'zh-hans': '输入框' } } },
  },
  plugins: [
    {
      name: manifest.name,
      title: { en: en.title, 'zh-hans': zh.title },
      description: { en: en.description, 'zh-hans': zh.description },
      // Inline, so the entry keeps its icon wherever the index is mirrored to.
      icon: `data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`,
      homepage: manifest.homepage,
      repository: { url: repoUrl },
      metadata: { category: 'interface', labels: ['composer'], keywords: manifest.keywords ?? [] },
      versions: [
        {
          version: manifest.version,
          publishTimestamp: publishedAt,
          source: useNpm
            ? { type: 'npm' }
            : { type: 'git', url: `${repoUrl}.git`, commit },
          engines: manifest.engines ?? {},
        },
      ],
    },
  ],
}

await writeFile(join(root, 'plugin-index.json'), `${JSON.stringify(index, null, 2)}\n`)
console.log(`plugin-index.json: ${manifest.name}@${manifest.version} from ${useNpm ? 'npm' : `git ${commit.slice(0, 7)}`}`)
