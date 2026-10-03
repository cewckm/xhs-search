/**
 * dsh-skill-xhs-search — Host half.
 *
 * Registers one runtime skill (`xhs-search`) into the DSH skill registry so any
 * session can load the full Xiaohongshu (小红书) search playbook on demand.
 *
 * Why a plugin and not just an on-disk SKILL.md: a runtime skill travels with
 * the package. The instruction body embeds the absolute paths this machine
 * actually resolves — the bundled scripts, the browser profile, the knowledge
 * base — so the loaded skill is directly runnable instead of a template the
 * model has to fill in by guessing.
 *
 * The skill body ships as `../skill/SKILL.md` (frontmatter + markdown). Path
 * placeholders `{{TOKEN}}` in that file are substituted at activation time.
 *
 * Also publishes a read-only status route when a Web server is mounted:
 *
 *     GET /dsh-skill-xhs-search/status   -> JSON diagnostics
 *
 * Everything that actually talks to Xiaohongshu lives in `../scripts/`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-skill-xhs-search'

/**
 * `skills` and `webServer` are read with ctx.get() rather than injected: the
 * skill registers when the registry is present, and the HTTP route appears only
 * when a Web shell exists. Neither absence should keep this row from activating.
 */
export const inject = []

const ROUTE = '/dsh-skill-xhs-search'
const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_SKILL_FILE = join(HERE, '..', 'skill', 'SKILL.md')
const DEFAULT_SCRIPTS = join(HERE, '..', 'scripts')

/**
 * Same workspace resolution as `scripts/config.mjs`: an existing
 * `~/Desktop/supian/xhs` knowledge base wins over the bare default, so the path
 * this plugin reports is the one the scripts will actually use.
 */
function defaultWorkspace() {
  const legacy = join(homedir(), 'Desktop', 'supian', 'xhs')
  if (existsSync(join(legacy, 'kb', 'notes.json'))) return legacy
  return join(homedir(), 'Desktop', 'xhs')
}

/** @typedef {{
 *   skillName?: string,
 *   skillFile?: string,
 *   scriptsDir?: string,
 *   workspace?: string,
 *   browserExe?: string,
 *   port?: number,
 *   statusRoute?: 'route' | 'off',
 * }} Config */

/**
 * Substitute `{{TOKEN}}` placeholders in the skill body.
 * Unknown tokens are left verbatim so a typo is visible in the loaded skill
 * rather than silently becoming an empty string.
 * @param {string} body - the raw SKILL.md text.
 * @param {Record<string, string>} values - token replacements.
 * @returns {string} the substituted body.
 */
function render(body, values) {
  return body.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, token) =>
    Object.prototype.hasOwnProperty.call(values, token) ? values[token] : whole)
}

/**
 * Split YAML frontmatter from a markdown body.
 * Deliberately minimal: the skill file is authored in this repository and only
 * needs `name` / `description` / `whenToUse`, all plain scalars.
 * @param {string} text - the whole file.
 * @returns {{ frontmatter: Record<string, string>, body: string }} both halves.
 */
function splitFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (match === null) return { frontmatter: {}, body: text }
  const frontmatter = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim())
    if (pair === null) continue
    let value = pair[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    frontmatter[pair[1]] = value
  }
  return { frontmatter, body: text.slice(match[0].length) }
}

/**
 * Host plugin body.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {Config} [config] - resolved plugin config.
 */
export function apply(ctx, config) {
  const options = config ?? {}
  const skillFile = resolve(options.skillFile ?? DEFAULT_SKILL_FILE)
  const scriptsDir = resolve(options.scriptsDir ?? DEFAULT_SCRIPTS)
  const workspace = resolve(options.workspace ?? defaultWorkspace())
  const skillName = options.skillName ?? 'xhs-search'
  const browserExe = options.browserExe ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  const port = Number(options.port ?? 9222)

  const values = {
    SKILL_NAME: skillName,
    PLUGIN_DIR: HERE,
    SCRIPTS_DIR: scriptsDir,
    WORKSPACE: workspace,
    BROWSER_EXE: browserExe,
    PORT: String(port),
    KB_DIR: join(workspace, 'kb'),
    REPORTS_DIR: join(workspace, 'reports'),
  }

  let body = ''
  let description = '搜索并阅读小红书笔记：系统级鼠标事件驱动隔离浏览器窗口，抓取正文与评论并落库。'
  let whenToUse = ''
  let loadError = null

  try {
    const raw = readFileSync(skillFile, 'utf8')
    const parsed = splitFrontmatter(raw)
    body = render(parsed.body, values)
    if (parsed.frontmatter.description) description = parsed.frontmatter.description
    if (parsed.frontmatter.whenToUse) whenToUse = parsed.frontmatter.whenToUse
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error)
  }

  const skills = ctx.get('skills')
  if (skills === undefined) {
    console.log('[dsh-skill-xhs-search] no skill registry mounted — skipping registration', { skillFile })
  } else if (loadError !== null) {
    console.log('[dsh-skill-xhs-search] skill body unreadable — skipping registration', { skillFile, loadError })
  } else {
    ctx.effect(() => skills.register({
      name: skillName,
      description,
      ...(whenToUse === '' ? {} : { whenToUse }),
      content: body,
    }), `dsh-skill-xhs-search: register "${skillName}"`)
  }

  // Machine-readable facts for the skill body, so a session can verify paths
  // without hardcoding this machine's layout into the instructions.
  const facts = {
    skillName,
    skillFile,
    skillFileExists: existsSync(skillFile),
    scriptsDir,
    scriptsDirExists: existsSync(scriptsDir),
    workspace,
    workspaceExists: existsSync(workspace),
    browserExe,
    browserExists: existsSync(browserExe),
    port,
    loadError,
  }
  try {
    writeFileSync(join(HERE, 'config.resolved.json'), `${JSON.stringify(facts, null, 2)}\n`, 'utf8')
  } catch { /* read-only install: diagnostics stay in-memory */ }

  console.log('[dsh-skill-xhs-search] host half active', {
    skill: skillName,
    registered: skills !== undefined && loadError === null,
    scriptsDir,
    workspace,
    port,
  })

  if (options.statusRoute === 'off') return
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return

  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: (req, res) => {
      const method = (req.method ?? 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
        res.end('method not allowed')
        return
      }
      const pathname = (req.url ?? '/').split('?')[0]
      if (pathname !== `${ROUTE}/status`) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }
      const payload = JSON.stringify(facts, null, 2)
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(method === 'HEAD' ? undefined : payload)
    },
  }), 'dsh-skill-xhs-search: status route')
}
