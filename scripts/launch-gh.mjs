/**
 * launch-gh.mjs — open a debuggable browser window for GitHub work.
 *
 * Why this exists: this skill drives pages through the Chrome DevTools Protocol,
 * which requires the browser to be started with --remote-debugging-port. Windows
 * browsers that are ALREADY running silently ignore that flag, and their profile
 * directory is locked, so the cookies cannot be copied either.
 *
 * This script therefore copies a subset of the normal profile into a separate
 * directory and starts a second, independent window against that copy. The result
 * is a window this tooling can drive, without touching the browser you are using.
 *
 * The copy deliberately skips caches (they are large and useless here) but keeps
 * Local Storage and the profile's Local State. Note that the cookie DB is usually
 * locked by the running browser, so the copied window may still ask you to sign in
 * once — after that the login lives in the copied profile.
 *
 *   node launch-gh.mjs                       # Edge, port 9222, opens GitHub
 *   node launch-gh.mjs --url https://github.com/settings/tokens/new
 *   node launch-gh.mjs --browser "C:\Program Files\Google\Chrome\Application\chrome.exe"
 *   node launch-gh.mjs --port 9223 --fresh   # discard the previous copy first
 */
import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Parse `--flag value` pairs and boolean flags. */
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
const port = Number(flags.port ?? 9222)
const url = typeof flags.url === 'string' ? flags.url : 'https://github.com'
const copyDir = join(homedir(), 'Desktop', 'gh-browser-profile')
const sourceRoots = [
  join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'User Data'),
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'User Data'),
]
const candidateBrowsers = [
  typeof flags.browser === 'string' ? flags.browser : undefined,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter((value) => typeof value === 'string' && value !== '')

const browser = candidateBrowsers.find((path) => existsSync(path))
if (browser === undefined) {
  console.error('no browser found; pass --browser "<path to msedge.exe or chrome.exe>"')
  process.exit(1)
}

/** Cache directories worth skipping: large, and irrelevant to a login session. */
const SKIP = new Set([
  'Code Cache', 'Cache', 'GPUCache', 'DawnWebGPUCache', 'DawnGraphiteCache',
  'Service Worker', 'Extensions', 'Extension State', 'ExtensionActivityEdge',
  'EntityExtraction', 'IndexedDB', 'WebStorage', 'Shared Dictionary',
  'GrShaderCache', 'ShaderCache', 'BrowserMetrics', 'component_crx_cache',
])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function probe() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(4000) })
    return res.ok ? (await res.json()).Browser : null
  } catch { return null }
}

const up = await probe()
if (up !== null) {
  console.log(`port ${port} is already answering (${up}) — reusing it`)
  process.exit(0)
}

if (flags.fresh === true && existsSync(copyDir)) {
  rmSync(copyDir, { recursive: true, force: true })
  console.log('removed the previous profile copy')
}

// Copy the profile once; later runs reuse it so the login persists.
const source = sourceRoots.find((root) => existsSync(join(root, 'Default', 'Network')))
const profileDefault = join(copyDir, 'Default')
if (!existsSync(join(profileDefault, 'Preferences')) && source !== undefined) {
  console.log(`copying profile from ${source} (skipping caches)…`)
  mkdirSync(profileDefault, { recursive: true })
  cpSync(join(source, 'Default'), profileDefault, {
    recursive: true,
    force: true,
    filter: (src) => {
      const parts = src.split(/[\\/]/)
      return !parts.some((part) => SKIP.has(part))
    },
  })
  for (const name of ['Local State', 'Last Version', 'First Run']) {
    const from = join(source, name)
    if (existsSync(from)) { try { copyFileSync(from, join(copyDir, name)) } catch { /* locked */ } }
  }
  console.log('profile copied (the cookie DB may be locked by the running browser —');
  console.log('if this window asks you to sign in, that is expected and only happens once)')
} else if (source === undefined) {
  console.log('no source profile found; starting with a fresh profile')
}

const child = spawn(browser, [
  `--remote-debugging-port=${port}`,
  '--remote-allow-origins=*',
  `--user-data-dir=${copyDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--window-size=1300,950',
  '--window-position=80,40',
  url,
], { detached: true, stdio: 'ignore' })
child.unref()

for (let attempt = 1; attempt <= 12; attempt += 1) {
  await sleep(3000)
  const now = await probe()
  if (now !== null) {
    console.log(`window up after ${attempt * 3}s: ${now}  (port ${port})`)
    console.log(`profile: ${copyDir}`)
    process.exit(0)
  }
}

console.error(`window did not expose a debug port on ${port} within 36s`)
console.error('hint: another browser may already be using the same --user-data-dir')
process.exit(1)
