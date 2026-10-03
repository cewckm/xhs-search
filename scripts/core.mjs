// core.mjs — shared CDP helpers for the isolated Xiaohongshu window.
// Pacing (think-time between requests) is controlled by the caller, not here.
import { CONFIG, describe } from './config.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect(port = CONFIG.port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const t = list.find((x) => x.type === 'page');
  if (!t) throw new Error('no page target on port ' + port);
  const ws = await new Promise((res, rej) => {
    const s = new WebSocket(t.webSocketDebuggerUrl);
    s.onopen = () => res(s);
    s.onerror = () => rej(new Error('ws connect failed'));
  });
  let n = 0;
  const rpc = (method, params = {}, timeout = 90000) => {
    const id = ++n;
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { ws.removeEventListener('message', on); reject(new Error('timeout ' + method)); }, timeout);
      const on = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.id !== id) return;
        clearTimeout(to); ws.removeEventListener('message', on);
        m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result);
      };
      ws.addEventListener('message', on);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  await rpc('Runtime.enable');
  await rpc('Page.enable');
  const evalJs = async (expression, timeout) => {
    const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeout);
    if (r.exceptionDetails) throw new Error('page exception: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  };
  return { ws, rpc, evalJs, close: () => { try { ws.close(); } catch {} } };
}

// ---- search page: the Vue store already holds the whole feed, incl. xsec_token ----
const SEARCH_JS = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const pick = (o, ...ks) => { for (const k of ks) if (o && o[k]) return o[k]; return null; };
  // relative publish time shown on the card: 3小时前 / 昨天 / 10-02 / 编辑于 2天前
  const cardsById = {};
  for (const el of document.querySelectorAll('section.note-item')) {
    const id = el.getAttribute('data-note-id');
    if (!id) continue;
    const m = clean(el.innerText).match(/(\\d+\\s*分钟前|\\d+\\s*小时前|刚刚|昨天|前天|\\d+\\s*天前|\\d{1,2}-\\d{1,2}|\\d{1,2}月\\d{1,2}日)/);
    cardsById[id] = m ? m[1] : null;
  }
  const out = { url: location.href, items: [], via: null };
  try {
    const feeds = window.__INITIAL_STATE__?.search?.feeds;
    const arr = feeds?._value || feeds?.value || (Array.isArray(feeds) ? feeds : []);
    if (arr && arr.length) {
      out.via = 'state';
      out.items = arr.map((x) => {
        const nc = x.noteCard || {}; const u = nc.user || {}; const ii = nc.interactInfo || {}; const cov = nc.cover || {};
        const rel = cardsById[x.id] || null;
        return {
          id: x.id, xsecToken: x.xsecToken || null,
          title: clean(nc.displayTitle || nc.title),
          author: clean(u.nickname), authorId: u.userId || null,
          likedCount: ii.likedCount || null, collectedCount: ii.collectedCount || null,
          commentCount: ii.commentCount || null, type: nc.type || null,
          relativeTime: rel, date: rel,
          cover: pick(cov, 'urlDefault', 'urlPre', 'url'),
        };
      }).filter((x) => x.id);
      return JSON.stringify(out);
    }
  } catch (e) { out.stateErr = e.message; }
  out.via = 'dom';
  out.items = Array.from(document.querySelectorAll('section.note-item')).map((c) => {
    const a = c.querySelector('a[href*="/explore/"], a[href*="/search_result/"]');
    const img = c.querySelector('img');
    const p = (...sel) => { for (const s of sel) { const e = c.querySelector(s); if (e && clean(e.textContent)) return clean(e.textContent); } return null; };
    const m = a && a.getAttribute('href') ? a.getAttribute('href').match(/\\/(?:explore|search_result)\\/([0-9a-f]+)/) : null;
    const rel = clean(c.innerText).match(/(\\d+\\s*分钟前|\\d+\\s*小时前|刚刚|昨天|前天|\\d+\\s*天前|\\d{1,2}-\\d{1,2})/);
    return { id: m ? m[1] : null, title: p('.title span', '.title'), author: p('.author .name', '.author'), likes: p('.like-wrapper .count'), cover: img ? img.src : null, xsecToken: null, relativeTime: rel ? rel[1] : null };
  }).filter((x) => x.id);
  return JSON.stringify(out);
})()`;

const DETAIL_JS = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const txt = (sel) => { const e = document.querySelector(sel); return e ? clean(e.textContent) : null; };
  const raw = (sel) => { const e = document.querySelector(sel); return e ? e.textContent : null; };
  const num = (sel) => { const t = txt(sel); if (!t) return null; const m = t.match(/[\\d.]+\\s*[万亿]?/); return m ? m[0] : t; };
  const imgs = Array.from(document.querySelectorAll('.swiper-slide img, .media-container img, .note-slider img'))
    .map((i) => i.src)
    .filter((s) => s && /sns-webpic|sns-img|ci\\.xiaohongshu/.test(s))
    .map((s) => s.split('?')[0]);
  const seen = new Set(); const uniq = [];
  for (const s of imgs) { if (!seen.has(s)) { seen.add(s); uniq.push(s); } }
  const tags = Array.from(document.querySelectorAll('#detail-desc .tag, .note-content .tag')).map((e) => clean(e.textContent)).filter(Boolean);
  return JSON.stringify({
    url: location.href,
    blocked: /当前笔记暂时无法浏览/.test(document.body.innerText),
    gate: /登录后查看/.test(document.body.innerText),
    title: txt('#detail-title') || txt('.note-content .title') || txt('.title'),
    body: txt('#detail-desc') || '',
    author: (txt('.author-container .username') || txt('.username') || '').replace(/关注$/, ''),
    date: txt('.date') || txt('.bottom-container .date') || txt('[class*="bottom-container"] .date') || txt('[class*="date"]'),
    ipLocation: txt('.ip-location') || null,
    likes: num('.like-wrapper .count'), collects: num('.collect-wrapper .count'), comments: num('.chat-wrapper .count'),
    tags, images: uniq.slice(0, 10)
  });
})()`;

const COMMENTS_JS = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const items = Array.from(document.querySelectorAll('.comment-item'))
    .filter((el) => !/comment-item-sub/.test(String(el.className)));
  const seen = new Set(); const out = [];
  for (const el of items) {
    const text = clean((el.querySelector('.content .note-text, .content') || {}).textContent || '');
    if (!text || text.length < 2) continue;
    const key = text.slice(0, 30);
    if (seen.has(key)) continue;
    seen.add(key);
    const author = clean((el.querySelector('.author .name, .author-wrapper .name') || {}).textContent || '');
    const likeEl = el.querySelector('.like .count') || el.querySelector('.like-wrapper .count') || el.querySelector('.like span.count');
    const likeTxt = likeEl ? clean(likeEl.textContent) : '';
    const replyEl = el.querySelector('.reply .count');
    out.push({
      author, text: text.slice(0, 800),
      likes: /^[\\d.]+\\s*[万亿]?$/.test(likeTxt) ? likeTxt : null,
      replies: replyEl ? Number(clean(replyEl.textContent)) || 0 : 0,
      date: clean((el.querySelector('.info .date span') || {}).textContent || ''),
      ip: clean((el.querySelector('.info .location') || {}).textContent || ''),
    });
    if (out.length >= 30) break;
  }
  return JSON.stringify(out);
})()`;

/** Load a search result page and return its feed items. */
export async function searchPage(c, keyword, sort = 'general', { scroll = false } = {}) {
  const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_explore_feed&sort=${sort}`;
  await c.rpc('Page.navigate', { url });
  await sleep(3500);
  let parsed = { items: [], via: null };
  for (let i = 0; i < 8; i++) {
    parsed = JSON.parse(await c.evalJs(SEARCH_JS));
    if (parsed.items.length) break;
    await sleep(1800);
  }
  if (scroll) {
    try {
      await c.evalJs('window.scrollTo(0, 1600); "ok"');
      await sleep(2200);
      const more = JSON.parse(await c.evalJs(SEARCH_JS));
      if (more.items.length > parsed.items.length) parsed = more;
    } catch {}
  }
  const gate = await c.evalJs('document.body.innerText.includes("登录后查看搜索结果")');
  return { keyword, sort, url, via: parsed.via, gate, items: parsed.items };
}

/** Open one note by id + xsec_token and return its detail plus visible comments. */
export async function noteDetail(c, id, token, { withComments = true } = {}) {
  // ── READ THIS BEFORE USING THIS FUNCTION ──────────────────────────────────
  // Direct navigation to a note URL is what triggers the anti-bot block. It is
  // kept only as a diagnostic / last resort: in practice the page comes back as
  // 安全限制 (300013) or 404 with `error_code=300031`, and once that happens the
  // whole TAB is redirected, so the next call fails too.
  //
  // The path that works is a genuine hardware click on the card:
  //     import { openNoteByOsClick } from './click-read.mjs'
  // If this function returns a blocked page, stop calling it and use that one.
  // ──────────────────────────────────────────────────────────────────────────
  const url = `https://www.xiaohongshu.com/explore/${id}?xsec_token=${encodeURIComponent(token || '')}&xsec_source=pc_search`;
  await c.rpc('Page.navigate', { url });
  await sleep(3800);
  let d = JSON.parse(await c.evalJs(DETAIL_JS));
  if (!d.title && !d.body) { await sleep(2500); d = JSON.parse(await c.evalJs(DETAIL_JS)); }
  let comments = [];
  if (withComments) {
    try {
      await c.evalJs(`(() => {
        const sc = document.querySelector('.note-scroller, .comments-el, .comments-container');
        if (sc) sc.scrollTop = sc.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
        return 'ok';
      })()`);
      await sleep(2400);
      comments = JSON.parse(await c.evalJs(COMMENTS_JS));
      if (!comments.length) { await sleep(2000); comments = JSON.parse(await c.evalJs(COMMENTS_JS)); }
    } catch { comments = []; }
  }
  return { ...d, comments, detailOk: !!(!d.blocked && (d.title || d.body)) };
}

// ─────────────────────────── CLI ───────────────────────────
//   node core.mjs search "<keyword>" [sort] [--scroll]
//   node core.mjs read <noteId> <xsecToken> [--no-comments]
//   node core.mjs plan                        # print explicit next steps for a session
if (process.argv[1] && process.argv[1].endsWith('core.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2)
  const flags = new Set(rest.filter((a) => a.startsWith('--')))
  const positional = rest.filter((a) => !a.startsWith('--'))

  if (cmd === 'search') {
    const keyword = positional[0]
    if (!keyword) {
      console.error('usage: node core.mjs search "<keyword>" [general|latest|popular] [--scroll]')
      process.exit(2)
    }
    const sort = positional[1] ?? 'latest'
    const c = await connect(CONFIG.port)
    try {
      const res = await searchPage(c, keyword, sort, { scroll: flags.has('--scroll') })
      console.log(`keyword: ${keyword}  sort: ${sort}  via: ${res.via}  gate: ${res.gate}  cards: ${res.items.length}`)
      if (res.gate) console.log('WARN login gate — 搜索需要登录，请在窗口里扫码')
      res.items.forEach((it, i) => {
        const ago = it.relativeTime ? ` [${it.relativeTime}]` : ''
        console.log(`${String(i + 1).padStart(2)}. [${it.likedCount ?? '-'}]${ago} ${(it.title || '(无标题)').slice(0, 46)}  @${it.author || '?'}`)
      })
      if (flags.has('--json')) console.log(JSON.stringify(res.items, null, 1))
    } finally { c.close() }
  } else if (cmd === 'read') {
    const [id, token] = positional
    if (!id || !token) {
      console.error('usage: node core.mjs read <noteId> <xsecToken> [--no-comments]')
      process.exit(2)
    }
    const c = await connect(CONFIG.port)
    try {
      const d = await noteDetail(c, id, token, { withComments: !flags.has('--no-comments') })
      console.log(`title : ${d.title}`)
      console.log(`author: ${d.author}  date: ${d.date ?? '-'}  ip: ${d.ipLocation ?? '-'}`)
      console.log(`likes : ${d.likes ?? '-'}  collects: ${d.collects ?? '-'}`)
      console.log(`images: ${(d.images || []).length}  comments: ${(d.comments || []).length}`)
      console.log(`blocked: ${d.blocked}  dead: ${d.dead}`)
      console.log('--- body ---')
      console.log(d.body || '(空)')
      if ((d.comments || []).length) {
        console.log('--- comments ---')
        for (const cm of d.comments.slice(0, 15)) {
          console.log(`  [${cm.likes ?? 0}赞|${cm.ip ?? '-'}] @${cm.author}: ${(cm.text || '').slice(0, 120)}`)
        }
      }
    } finally { c.close() }
  } else if (cmd === 'plan') {
    console.log('next steps:')
    console.log(`  1. node launch.mjs                         # start the isolated window (${CONFIG.browserExe})`)
    console.log('  2. node calibrate.mjs                      # once per window position')
    console.log(`  3. node crawler.mjs                        # continuous crawl into ${CONFIG.kbDir}`)
    console.log('  4. python synthesize.py 1 1970-01-01T00:00:00.000Z 2100-01-01T00:00:00.000Z')
    console.log('config:', JSON.stringify(describe(), null, 1))
  } else {
    console.log('usage: node core.mjs <search|read|plan> ...')
    process.exit(cmd === undefined ? 0 : 2)
  }
}
