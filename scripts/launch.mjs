/**
 * launch.mjs — start the isolated browser window this skill drives.
 *
 *   node launch.mjs            # start (or report that it is already up)
 *   node launch.mjs --status   # only report
 *   node launch.mjs --force    # start a second window even if one answers
 *
 * The window uses its OWN user-data-dir, so it never touches the browser the
 * human is using. The login for Xiaohongshu is stored in that profile: scan once
 * in this window and later launches stay logged in.
 */
import { mkdirSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { CONFIG, describe, saveConfig } from './config.mjs'

const args = process.argv.slice(2)
const statusOnly = args.includes('--status')
const force = args.includes('--force')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** @returns {Promise<{ok: boolean, browser?: string, error?: string}>} port probe. */
async function probe() {
  try {
    const res = await fetch(`http://127.0.0.1:${CONFIG.port}/json/version`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return { ok: false, error: `http ${res.status}` }
    const info = await res.json()
    return { ok: true, browser: info.Browser }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const facts = describe()
console.log('[xhs] resolved config:', JSON.stringify(facts, null, 2))

const already = await probe()
if (already.ok) {
  console.log(`[xhs] debug port ${CONFIG.port} already answering: ${already.browser}`)
  if (!force) {
    console.log('[xhs] nothing to do (pass --force to start another window)')
    process.exit(0)
  }
}

if (statusOnly) {
  console.log(already.ok ? '[xhs] up' : `[xhs] down (${already.error})`)
  process.exit(already.ok ? 0 : 1)
}

if (!existsSync(CONFIG.browserExe)) {
  console.error(`[xhs] browser executable not found: ${CONFIG.browserExe}`)
  console.error('[xhs] set XHS_BROWSER, or pass a path in scripts/config.json')
  process.exit(1)
}

mkdirSync(CONFIG.profileDir, { recursive: true })
saveConfig()

const child = spawn(CONFIG.browserExe, [
  `--remote-debugging-port=${CONFIG.port}`,
  '--remote-allow-origins=*',
  `--user-data-dir=${CONFIG.profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--window-size=1300,900',
  '--window-position=80,40',
  'https://www.xiaohongshu.com/explore',
], { detached: true, stdio: 'ignore' })
child.unref()

for (let attempt = 1; attempt <= 12; attempt += 1) {
  await sleep(3000)
  const now = await probe()
  if (now.ok) {
    console.log(`[xhs] window up after ${attempt * 3}s: ${now.browser}`)
    console.log(`[xhs] next: node calibrate.mjs   (once per window position)`)
    console.log(`[xhs] if Xiaohongshu asks for login, scan the QR code IN THIS WINDOW.`)
    process.exit(0)
  }
}

console.error('[xhs] window did not expose its debug port in 36s')
console.error(`[xhs] check: is another browser already using ${CONFIG.profileDir}?`)
process.exit(1)
