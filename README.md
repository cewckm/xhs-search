# xhs-search

**English** | [中文](README.zh.md)

**A Xiaohongshu (RED / rednote) note-search skill for DeepSeek Harness** — search a keyword,
open notes, capture body text and comments, accumulate them in a local knowledge base, then
synthesise an illustrated report.

Packaged as a DSH plugin (`dsh.skill`): once installed, any session can say "look up xxx on
Xiaohongshu" and the model loads the `xhs-search` skill with a complete, executable playbook.

---

## Why it exists

Xiaohongshu's web client detects automation, and a naive fetch walks into three walls in a row.
This project packages the way around them:

| Approach | Result |
|---|---|
| Requesting a note URL directly | ❌ `安全限制 300013` / `error_code 300031 当前笔记暂时无法浏览` |
| Browser-synthesised clicks (CDP `Input.dispatchMouseEvent`) | ❌ Works a few times, then gets flagged → security restriction / captcha |
| **Windows OS-level mouse events** (`SetCursorPos` + `mouse_event`) | ✅ Equivalent to a human click; stable over long runs |

Measured comparison (same moment, same account): **URL navigation was blocked while an OS-level
click successfully read 265 characters of body text.**

Beyond anti-bot, it fixes three practical traps:

- **Virtualised search list**: the API returns 44–66 cards but the DOM renders only ~30 → click
  only the cards that actually exist;
- **Detail endpoint returns 500**: `/api/sns/web/v1/feed` always fails → read body text and
  comments from the DOM only;
- **Images are WebP**: the URL ends in `.jpg` but the bytes are WebP, which python-docx rejects →
  sniff the magic bytes and transcode.

---

## Layout

```
.
├── plugin/            DSH plugin
│   ├── package.json     manifest (dsh.skill points at the skill and scripts)
│   ├── index.js         Host side: registers the runtime skill + status endpoint
│   ├── install.mjs      install / uninstall (writes the profile patch layer)
│   ├── selftest.mjs     verify without DSH running (mock context)
│   └── README.md        installation and usage details
├── skill/SKILL.md     the skill body (the playbook the model loads)
├── scripts/           runnable implementation
│   ├── config.mjs       path resolution (env vars / config.json / defaults)
│   ├── launch.mjs       start the isolated browser with a debug port
│   ├── calibrate.mjs    self-verifying viewport-origin calibration (prerequisite for OS clicks)
│   ├── osclick.mjs/.ps1 Windows OS-level mouse input
│   ├── core.mjs         CDP search / read a note
│   ├── click-read.mjs   click-based reading (handles the virtualised list)
│   ├── crawler.mjs      continuous collection + rate-limit backoff
│   ├── campaign.mjs     collection + scheduled report orchestration
│   ├── kb.mjs           knowledge base
│   ├── imgfetch.mjs     image download (WebP → JPEG)
│   ├── synthesize.py    report synthesis (cross-note agreement / unanswered questions / images)
│   ├── intel.py         search the knowledge base
│   └── md2docx.py       Markdown → Word
└── docs/QUICKSTART.md 5-minute quick start
```

---

## Quick start

**Without the plugin, straight from the scripts:**

```powershell
git clone <this repo>
cd scripts

node launch.mjs      # start the isolated browser (scan the QR code in that window once)
node calibrate.mjs   # calibrate the mouse coordinate mapping (self-verifying)
node core.mjs search "keyword" latest
```

**Install as a DSH skill:**

```powershell
cd plugin
node install.mjs
# then exit DSH completely (including the tray icon) and start it again
```

See [plugin/README.md](plugin/README.md) and [docs/QUICKSTART.md](docs/QUICKSTART.md).

---

## Requirements

| Requirement | Notes |
|---|---|
| **Windows** | OS-level mouse events go through `user32.dll` (PowerShell + P/Invoke). On macOS/Linux you would swap in `cliclick` / `xdotool` |
| **Node.js ≥ 18** | Uses the built-in `fetch` and `WebSocket` |
| **Python + Pillow** | Needed only for report generation and image transcoding |
| **Edge or Chrome** | Auto-detected; override with `XHS_BROWSER` |
| A Xiaohongshu account | Sign in by QR code in the isolated window once; the session persists in the local profile |

---

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `XHS_WORKSPACE` | `~/Desktop/xhs` | Where the knowledge base, browser profile and reports live |
| `XHS_BROWSER` | auto-detected | Browser executable |
| `XHS_PORT` | `9222` | Debug port |
| `XHS_PYTHON` | `python` | Python used by the report tooling |
| `XHS_DETAIL_GAP_MS` | `25000` | Gap between opening notes |
| `XHS_SEARCH_GAP_MS` | `30000` | Gap between searches |
| `XHS_MAX_DETAILS_PER_HOUR` | `60` | Hard cap on notes opened per hour |
| `XHS_BLOCK_COOLDOWN_MS` | `1200000` | Cooldown after hitting a rate limit |
| `XHS_END_HOUR` | `22` | Hour of day the scheduled job stops |

---

## Where the data lives

```
<workspace>/
├── edge-profile/     session state of the isolated window (separate from your daily browser)
├── kb/
│   ├── notes.json     notes (body / author / time / likes / images / comments / source keyword)
│   ├── searches.json  search history
│   └── img/           downloaded images (JPEG)
└── reports/           reports (md + docx, with embedded images)
```

---

## Known limitations

- **Windows only**: the core clicking and calibration depend on Win32 APIs.
- **Clicking briefly takes over the real mouse**: each click moves the cursor for about 0.2 s, so
  running a batch is not compatible with using the machine at the same time.
- **Platform rate limits are per account**, not per "human-like click". Measured: more than
  roughly 100 notes per half hour triggers a security restriction.
- **Sessions expire** and occasionally need a new QR scan.
- **Page structure can change**, in which case selectors (`#detail-desc`, `.comment-item`, …) need
  updating.
- Paths embedded in the skill body are **absolute paths resolved at install time**, so a new
  machine requires re-running the installer.

---

## Compliance and disclaimer

- This project is **read-only**: search, read notes, read comments. It does not like, comment,
  follow, post or send direct messages.
- Only process public content the user is entitled to access. **The session belongs to the user —
  never export or share the cookies.**
- Respect the default rate limits. High-frequency bulk scraping triggers platform risk controls
  and may violate the platform's terms of service.
- When publishing organised material, credit the Xiaohongshu users who created it and respect
  their authorship.
- This project is intended for personal study and information organisation only; users bear
  responsibility for their own compliance.

---

## License

MIT — see [LICENSE](LICENSE).
