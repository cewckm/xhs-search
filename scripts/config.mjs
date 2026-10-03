/**
 * config.mjs — one place that resolves every path this skill uses.
 *
 * Resolution order (first hit wins):
 *   1. environment variables   XHS_WORKSPACE / XHS_BROWSER / XHS_PORT
 *   2. config.json beside this file   (written by install.mjs / launch.mjs)
 *   3. built-in defaults
 *
 * Keeping this in one module is what lets the same scripts run from the plugin
 * checkout, from an installed profile, or from any copied directory.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = join(HERE, 'config.json')

/** Read the optional config.json beside this module. */
function readConfig() {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const file = readConfig()

/**
 * Locate the browser executable, preferring a real file over a guess.
 * Edge ships with Windows; Chrome and Chromium are accepted as fallbacks so the
 * skill still works on a machine without Edge.
 */
function findBrowser() {
  const candidates = [
    process.env.XHS_BROWSER,
    file.browserExe,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter((value) => typeof value === 'string' && value.trim() !== '')
  return candidates.find((path) => existsSync(path)) ?? candidates[0]
}

/**
 * Where this skill keeps its browser profile, knowledge base and reports.
 *
 * Default: `~/Desktop/xhs`, except that an existing `~/Desktop/supian/xhs` wins —
 * that is where this skill's first deployment put its 85 MB knowledge base, and
 * silently starting a second empty workspace would re-download everything.
 */
function findWorkspace() {
  const explicit = process.env.XHS_WORKSPACE ?? file.workspace
  if (typeof explicit === 'string' && explicit.trim() !== '') return resolve(explicit)
  const legacy = join(homedir(), 'Desktop', 'supian', 'xhs')
  if (existsSync(join(legacy, 'kb', 'notes.json'))) return legacy
  return join(homedir(), 'Desktop', 'xhs')
}

export const CONFIG = {
  workspace: findWorkspace(),
  browserExe: findBrowser(),
  port: Number(process.env.XHS_PORT ?? file.port ?? 9222),
  /** Absolute directory holding these scripts. */
  scriptsDir: HERE,
  /** Which python to use for the report tooling; empty means `python` from PATH. */
  python: process.env.XHS_PYTHON ?? file.python ?? 'python',
}

CONFIG.profileDir = join(CONFIG.workspace, 'edge-profile')
CONFIG.kbDir = join(CONFIG.workspace, 'kb')
CONFIG.reportsDir = join(CONFIG.workspace, 'reports')
CONFIG.heartbeat = join(CONFIG.workspace, 'heartbeat.json')
CONFIG.calibration = join(HERE, 'osclick-cal.json')

/** Persist the resolved values so the next run starts from the same place. */
export function saveConfig(patch = {}) {
  const next = {
    workspace: CONFIG.workspace,
    browserExe: CONFIG.browserExe,
    port: CONFIG.port,
    python: CONFIG.python,
    ...readConfig(),
    ...patch,
  }
  writeFileSync(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

/** Human-readable summary for logs and troubleshooting. */
export function describe() {
  return {
    workspace: CONFIG.workspace,
    workspaceExists: existsSync(CONFIG.workspace),
    browserExe: CONFIG.browserExe,
    browserExists: existsSync(CONFIG.browserExe),
    port: CONFIG.port,
    scriptsDir: CONFIG.scriptsDir,
    profileDir: CONFIG.profileDir,
    profileExists: existsSync(CONFIG.profileDir),
    kbExists: existsSync(CONFIG.kbDir),
  }
}
