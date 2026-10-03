/**
 * install.mjs — install this skill plugin into a DSH profile.
 *
 *     node install.mjs
 *     node install.mjs --profile desktop --home C:\Users\you\.dsh
 *     node install.mjs --browser "C:\Program Files\Google\Chrome\Application\chrome.exe"
 *     node install.mjs --workspace "D:\xhs-data"
 *     node install.mjs --uninstall
 *
 * ── WHY IT COPIES INTO node_modules ──────────────────────────────────────────
 *
 * The loader resolves a row's `name` as a PACKAGE SPECIFIER out of the profile,
 * so the plugin has to exist under <profile>/node_modules. The copy carries the
 * Host half (index.js) and the manifest; the skill body and scripts are NOT
 * copied — the manifest points back at this checkout (`dsh.skill.bundle`), so
 * exactly one copy of the authored content exists and editing it here is enough.
 *
 * After installing: completely quit DSH (tray icon too) and reopen it.
 */
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PKG = 'dsh-skill-xhs-search'
const ROW_ID = 'skill-xhs-search'

/** Parse `--flag value` pairs. */
function parseArgs(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) flags[key] = true
    else { flags[key] = next; index += 1 }
  }
  return flags
}

const flags = parseArgs(process.argv.slice(2))
const home = typeof flags.home === 'string' ? flags.home : (process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const profile = typeof flags.profile === 'string' ? flags.profile : (process.env.DSH_PROFILE ?? 'desktop')
const profileDir = join(home, 'profiles', profile)
const patchPath = join(profileDir, 'cordis.patch.yml')
const installed = join(profileDir, 'node_modules', PKG)

if (!existsSync(profileDir)) {
  console.error(`profile not found: ${profileDir}`)
  console.error('pass the right one with --profile <name>, or --home <dsh home>')
  process.exit(1)
}

/** One YAML scalar, single-quoted so Windows paths survive verbatim. */
const scalar = (value) => `'${String(value).replaceAll("'", "''")}'`

if (flags.uninstall === true || flags.remove === true) {
  await rm(installed, { recursive: true, force: true })
  if (existsSync(patchPath)) {
    const before = await readFile(patchPath, 'utf8')
    const row = new RegExp(`- id: ${ROW_ID}\\n[\\s\\S]*?(?=\\n- |\\n# |$)`)
    const after = before.replace(row, '').replace(/\n{3,}/g, '\n\n')
    if (after !== before) {
      await copyFile(patchPath, `${patchPath}.bak`)
      await writeFile(patchPath, after, 'utf8')
    }
  }
  console.log(`uninstalled ${PKG} from profile "${profile}"`)
  console.log('restart DSH to drop the skill from the catalog')
  process.exit(0)
}

// The installed copy is self-contained for code, but the skill body and the
// scripts stay in this checkout: the manifest's `dsh.skill.bundle` and the
// config below both point back here.
const manifest = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'))
delete manifest.dependencies
delete manifest.devDependencies
manifest.private = true

await mkdir(installed, { recursive: true })
await writeFile(join(installed, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
await copyFile(join(here, 'index.js'), join(installed, 'index.js'))

const configLines = [
  `    skillFile: ${scalar(join(here, '..', 'skill', 'SKILL.md'))}`,
  `    scriptsDir: ${scalar(join(here, '..', 'scripts'))}`,
]
if (typeof flags.workspace === 'string') configLines.push(`    workspace: ${scalar(flags.workspace)}`)
if (typeof flags.browser === 'string') configLines.push(`    browserExe: ${scalar(flags.browser)}`)
if (typeof flags.port === 'string') configLines.push(`    port: ${Number(flags.port)}`)

const block = `# ── xhs-search skill ─────────────────────────────────────────────────────────
# Authored in  ${here}
# Installed to ${installed}
#
# Registers ONE runtime skill named "xhs-search" (小红书笔记搜索与阅读). The row
# names the PACKAGE, not a file path: the loader resolves it out of this
# profile's node_modules.
#
# Remove this block (or run \`node install.mjs --uninstall\`) and restart DSH.
- id: ${ROW_ID}
  name: ${PKG}
  config:
${configLines.join('\n')}
`

const existing = existsSync(patchPath) ? await readFile(patchPath, 'utf8') : '# Your patch layer for this dsh profile.\n[]\n'
const row = new RegExp(`- id: ${ROW_ID}\\n[\\s\\S]*?(?=\\n- |\\n# |$)`)
let next
if (existing.includes(`id: ${ROW_ID}`)) {
  next = existing.replace(row, block.trimEnd())
} else if (/^\s*\[\s*\]\s*$/m.test(existing)) {
  next = `${existing.replace(/^\s*\[\s*\]\s*$/m, '').trimEnd()}\n\n${block}`
} else {
  next = `${existing.trimEnd()}\n\n${block}`
}

await copyFile(patchPath, `${patchPath}.bak`)
await writeFile(patchPath, next, 'utf8')

console.log(`installed ${PKG} into profile "${profile}"`)
console.log(`  package : ${installed}`)
console.log(`  skill   : ${join(here, '..', 'skill', 'SKILL.md')}`)
console.log(`  scripts : ${join(here, '..', 'scripts')}`)
console.log(`  patch   : ${patchPath}   (previous copy kept as cordis.patch.yml.bak)`)
console.log('')
console.log('Next:')
console.log('  1. completely quit DSH (Windows tray icon too) and reopen it')
console.log('  2. the session catalog will list: xhs-search')
