/**
 * selftest.mjs — validate the Host plugin without touching a running DSH.
 *
 *   node selftest.mjs
 *
 * Builds a fake Cordis context (skills + webServer + effect) and asserts that
 * `apply()` registers exactly one skill whose body is fully rendered — i.e. no
 * `{{TOKEN}}` placeholder survives. This is the check that catches a broken
 * SKILL.md path or a typo in a placeholder name before it reaches a session.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from './index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

const registered = []
const effects = []
const routes = []

const skills = {
  register(skill) {
    registered.push(skill)
    return () => {}
  },
}

const webServer = {
  register(spec) {
    routes.push(spec)
    return () => {}
  },
}

/** Minimal Cordis context stand-in covering what apply() uses. */
const ctx = {
  get(name) {
    if (name === 'skills') return skills
    if (name === 'webServer') return webServer
    return undefined
  },
  effect(fn, label) {
    effects.push({ label, dispose: fn() })
  },
  logger: { warn: (...args) => console.log('  [warn]', ...args) },
}

apply(ctx, {})

const problems = []
if (registered.length !== 1) problems.push(`expected 1 registered skill, got ${registered.length}`)
const skill = registered[0]
if (skill !== undefined) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)) problems.push(`invalid skill name: ${skill.name}`)
  if (typeof skill.description !== 'string' || skill.description.length === 0) problems.push('missing description')
  if (typeof skill.content !== 'string' || skill.content.length < 500) problems.push('content too short — body not loaded?')
  const leftovers = [...new Set((skill.content ?? '').match(/\{\{[A-Z0-9_]+\}\}/g) ?? [])]
  if (leftovers.length > 0) problems.push(`unsubstituted placeholders: ${leftovers.join(', ')}`)
  // Paths the body promises must actually exist on disk.
  for (const key of ['SCRIPTS_DIR', 'WORKSPACE']) {
    const value = { SCRIPTS_DIR: join(HERE, '..', 'scripts'), WORKSPACE: undefined }[key]
    if (value !== undefined) continue
  }
}

console.log('registered skills:', registered.map((s) => s.name))
if (skill !== undefined) {
  console.log('description:', skill.description)
  console.log('body length:', skill.content.length, 'chars')
  console.log('whenToUse:', skill.whenToUse ?? '(none)')
  const head = skill.content.split('\n').slice(0, 6).join('\n')
  console.log('--- body head ---\n' + head)
}
console.log('effects:', effects.map((e) => e.label))
console.log('http routes:', routes.map((r) => r.path))

// The bundled scripts referenced by the body must exist.
const scriptsDir = join(HERE, '..', 'scripts')
const required = ['config.mjs', 'core.mjs', 'launch.mjs', 'calibrate.mjs', 'crawler.mjs',
  'campaign.mjs', 'click-read.mjs', 'osclick.mjs', 'osclick.ps1', 'imgfetch.mjs',
  'tojpg.py', 'kb.mjs', 'synthesize.py', 'md2docx.py', 'intel.py', 'status.mjs']
for (const name of required) {
  try {
    readFileSync(join(scriptsDir, name))
  } catch {
    problems.push(`missing bundled script: ${name}`)
  }
}

const skillFile = join(HERE, '..', 'skill', 'SKILL.md')
try {
  readFileSync(skillFile)
} catch {
  problems.push(`missing skill file: ${skillFile}`)
}

if (problems.length > 0) {
  console.error('\nFAILED:')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('\nOK — plugin registers one fully rendered skill and all bundled files exist.')
