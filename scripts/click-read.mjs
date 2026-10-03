// Real-input clicking: open notes by driving the actual mouse, then read the detail panel.
import { connect, searchPage, sleep } from './core.mjs';

const DETAIL_JS = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const txt = (sel) => { const e = document.querySelector(sel); return e ? clean(e.textContent) : null; };
  const imgs = Array.from(document.querySelectorAll('.swiper-slide img, .media-container img, .note-slider img'))
    .map((i) => i.src).filter((s) => s && /sns-webpic|sns-img|ci\\.xiaohongshu/.test(s)).map((s) => s.split('?')[0]);
  const seen = new Set(); const uniq = [];
  for (const s of imgs) { if (!seen.has(s)) { seen.add(s); uniq.push(s); } }
  return JSON.stringify({
    url: location.href,
    blocked: /安全限制|访问频繁/.test(document.body.innerText),
    dead: /404|暂时无法浏览/.test(location.href + document.body.innerText.slice(0, 200)),
    title: txt('#detail-title') || txt('.note-content .title'),
    body: txt('#detail-desc') || '',
    author: (txt('.author-container .username') || '').replace(/关注$/, ''),
    date: txt('.date') || txt('.bottom-container .date'),
    ipLocation: txt('.ip-location'),
    likes: txt('.like-wrapper .count'), collects: txt('.collect-wrapper .count'), comments: txt('.chat-wrapper .count'),
    images: uniq.slice(0, 10),
  });
})()`;

const COMMENTS_JS = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const seen = new Set(); const out = [];
  for (const el of Array.from(document.querySelectorAll('.comment-item')).filter((e) => !/comment-item-sub/.test(String(e.className)))) {
    const text = clean((el.querySelector('.content .note-text, .content') || {}).textContent || '');
    if (!text || text.length < 2) continue;
    const k = text.slice(0, 30); if (seen.has(k)) continue; seen.add(k);
    const likeEl = el.querySelector('.like .count') || el.querySelector('.like-wrapper .count') || el.querySelector('.like span.count');
    const lt = likeEl ? clean(likeEl.textContent) : '';
    const reEl = el.querySelector('.reply .count');
    out.push({ author: clean((el.querySelector('.author .name') || {}).textContent || ''), text: text.slice(0, 800),
      likes: /^[\\d.]+\\s*[万亿]?$/.test(lt) ? lt : null,
      replies: reEl ? Number(clean(reEl.textContent)) || 0 : 0,
      date: clean((el.querySelector('.info .date span') || {}).textContent || ''),
      ip: clean((el.querySelector('.info .location') || {}).textContent || '') });
    if (out.length >= 30) break;
  }
  return JSON.stringify(out);
})()`;

/** A trusted-looking click: move (with steps + jitter), press, release. */
async function realClick(c, x, y) {
  await c.rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 40, y: y - 30, button: 'none' });
  await sleep(90);
  for (let i = 1; i <= 4; i++) {
    await c.rpc('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(x - 40 + (40 * i) / 4 + (Math.random() * 6 - 3)),
      y: Math.round(y - 30 + (30 * i) / 4 + (Math.random() * 6 - 3)),
      button: 'none',
    });
    await sleep(40 + Math.random() * 60);
  }
  await c.rpc('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(80 + Math.random() * 70);
  await c.rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
}

/** Which note ids are actually rendered on the page right now (the list is virtualised). */
export async function domCardIds(c) {
  try {
    const raw = await c.evalJs(`JSON.stringify(Array.from(document.querySelectorAll('section.note-item'))
      .map((el) => el.getAttribute('data-note-id'))
      .filter((x) => x && !x.includes('#')))`);
    return JSON.parse(raw || '[]');
  } catch { return []; }
}

/** Human-ish scroll to make the virtualised list render more cards. */
export async function scrollFeed(c, deltaY = 900) {
  try {
    await c.rpc('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 700, deltaX: 0, deltaY });
  } catch {
    try { await c.evalJs(`window.scrollBy(0, ${deltaY}); 'ok'`); } catch {}
  }
  await sleep(1800 + Math.random() * 1200);
}

/** Pick the first visible, non-empty element inside the card as the click target. */
const FIND_TARGET_JS = (noteId) => `(() => {
  const cards = Array.from(document.querySelectorAll('section.note-item'));
  const card = document.querySelector('section.note-item[data-note-id="${noteId}"]')
    || cards.find((el) => el.innerHTML.includes(${JSON.stringify(noteId)}));
  if (!card) {
    const ids = cards.map((el) => el.getAttribute('data-note-id')).filter(Boolean);
    return JSON.stringify({
      err: 'card-not-found',
      cardsInDom: cards.length,
      domIds: ids.slice(0, 12),
      idInAnyHtml: document.body.innerHTML.includes(${JSON.stringify(noteId)}),
      scrollY: Math.round(window.scrollY),
      docHeight: Math.round(document.body.scrollHeight),
      viewportH: innerHeight,
    });
  }
  card.scrollIntoView({ block: 'center', behavior: 'instant' });
  const cands = Array.from(card.querySelectorAll('a, img, div, span'));
  let best = null;
  for (const el of cands) {
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 60) continue;          // skip hidden / tiny nodes
    if (r.top < 0 || r.top > innerHeight || r.left < 0 || r.left > innerWidth) continue;
    if (!best || r.width * r.height > best.area) best = { el, area: r.width * r.height, r };
  }
  if (!best) {
    const r = card.getBoundingClientRect();
    if (r.width > 0) best = { el: card, area: r.width * r.height, r };
  }
  if (!best) return JSON.stringify({ err: 'no-visible-target', cardRect: card.getBoundingClientRect().toJSON() });
  const r = best.r;
  return JSON.stringify({
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + Math.min(r.height * 0.35, 130)),
    tag: best.el.tagName, cls: String(best.el.className).slice(0, 40),
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
  });
})()`;

/** Open a note from the current results grid by clicking its card, then read it. */
export async function openNoteByClick(c, noteId, { attempts = 3 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const raw = await c.evalJs(FIND_TARGET_JS(noteId));
    const t = JSON.parse(raw);
    if (t.err) {
      if (process.env.XHS_DEBUG) console.log('  [diag] ' + JSON.stringify(t));
      if (attempt === attempts) return { ok: false, reason: t.err, diag: t };
      await sleep(1500);
      continue;
    }
    await sleep(150 + Math.random() * 250);
    await realClick(c, t.x, t.y);
    await sleep(4000 + Math.random() * 1200);

    let d = JSON.parse(await c.evalJs(DETAIL_JS));
    const opened = !!(d.title || d.body) || d.blocked || d.dead;
    if (!opened) {
      await sleep(2600);
      d = JSON.parse(await c.evalJs(DETAIL_JS));
    }
    if (d.title || d.body || d.blocked || d.dead) {
      let comments = [];
      if ((d.title || d.body) && !d.blocked && !d.dead) {
        try {
          await c.rpc('Input.dispatchMouseEvent', { type: 'mouseWheel', x: t.x, y: t.y, deltaX: 0, deltaY: 800 });
          await sleep(1500);
          comments = JSON.parse(await c.evalJs(COMMENTS_JS));
        } catch {}
      }
      return { ok: true, detail: { ...d, comments }, target: t, attempt };
    }
    // click missed — nudge and retry
    await sleep(1200);
  }
  return { ok: false, reason: 'panel-never-opened' };
}

const PANEL_OPEN_JS = `(() => {
  const t = document.querySelector('#detail-title');
  const d = document.querySelector('#detail-desc');
  const has = (t && t.textContent.trim()) || (d && d.textContent.trim());
  return JSON.stringify({ open: !!has, title: t ? t.textContent.trim().slice(0, 30) : null });
})()`;

/** Close the note overlay and confirm we are back on the results grid. */
export async function closeNote(c) {
  // 1) try the visible close / mask element
  const pos = await c.evalJs(`(() => {
    for (const sel of ['.close-circle', '.note-detail-mask', '.close']) {
      const m = document.querySelector(sel);
      if (!m) continue;
      const r = m.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), sel });
    }
    return null;
  })()`);
  if (pos) {
    const { x, y } = JSON.parse(pos);
    await realClick(c, x, y);
    await sleep(1800);
  }
  // 2) ESC as a fallback
  let state = JSON.parse(await c.evalJs(PANEL_OPEN_JS));
  if (state.open) {
    await c.rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(150);
    await c.rpc('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(1800);
    state = JSON.parse(await c.evalJs(PANEL_OPEN_JS));
  }
  return !state.open;
}

// ---------------- OS-level (hardware) clicking ----------------
import { loadCalibration, osClick } from './osclick.mjs';

/** How old is this card? Used to keep the crawl focused on the last couple of days. */
export function isFreshCard(card, { hours = 72 } = {}) {
  const rel = `${card.relativeTime || ''} ${card.date || ''}`.trim();
  if (!rel) return true;                       // unknown → keep, better safe than sorry
  if (/刚刚|分钟前|小时前/.test(rel)) return true;
  if (/昨天|前天/.test(rel)) return true;
  const d = rel.match(/(\d+)\s*天前/);
  if (d) return Number(d[1]) <= 3;
  const md = rel.match(/(\d{1,2})-(\d{1,2})/);  // e.g. 10-02
  if (md) {
    const m = Number(md[1]), day = Number(md[2]);
    if (m === 10 && day >= 1) return true;
  }
  if (/10月\d{1,2}日/.test(rel)) return true;
  return true;
}

/**
 * Read a note by clicking its card with a genuine OS-level mouse event.
 * Requires calibration (run calibrate2.mjs once per window position).
 */
export async function openNoteByOsClick(c, noteId, { attempts = 3 } = {}) {
  const cal = loadCalibration();
  if (!cal) return { ok: false, reason: 'no-calibration' };
  const origin = { left: cal.left, top: cal.top };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const raw = await c.evalJs(FIND_TARGET_JS(noteId));
    const t = JSON.parse(raw);
    if (t.err) {
      if (attempt === attempts) return { ok: false, reason: t.err, diag: t };
      await sleep(1500);
      continue;
    }
    await sleep(150 + Math.random() * 300);
    osClick(t.x, t.y, origin);
    await sleep(3800 + Math.random() * 1400);

    let d = JSON.parse(await c.evalJs(DETAIL_JS));
    if (!(d.title || d.body || d.blocked || d.dead)) {
      await sleep(2500);
      d = JSON.parse(await c.evalJs(DETAIL_JS));
    }
    if (d.title || d.body || d.blocked || d.dead) {
      let comments = [];
      if ((d.title || d.body) && !d.blocked && !d.dead) {
        try {
          await c.rpc('Input.dispatchMouseEvent', { type: 'mouseWheel', x: t.x, y: t.y, deltaX: 0, deltaY: 800 });
          await sleep(1500);
          comments = JSON.parse(await c.evalJs(COMMENTS_JS));
        } catch {}
      }
      return { ok: true, detail: { ...d, comments }, target: t, attempt };
    }
    await sleep(1200);
  }
  return { ok: false, reason: 'panel-never-opened' };
}

// ---------------- self test ----------------
if (process.argv[2] === 'test') {
  const c = await connect(9222);
  try {
    const res = await searchPage(c, process.argv[3] || 'REDLAND 10月4日', 'latest', { scroll: false });
    const items = (res.items || []).filter((x) => x.xsecToken).slice(0, 5);
    console.log(`测试点击 ${items.length} 篇（含关闭验证）\n`);
    let ok = 0, bad = 0;
    const seenTitles = new Set();
    for (const it of items) {
      // make sure the grid is clean before each click
      let clean = await closeNote(c);
      if (!clean) { console.log('  （面板未关闭，强制重载搜索页）'); await searchPage(c, process.argv[3] || 'REDLAND 10月4日', 'latest', { scroll: false }); await sleep(1500); }

      const r = await openNoteByClick(c, it.id);
      if (!r.ok) { console.log(`✗ ${(it.title || '').slice(0, 30)} — ${r.reason}`); bad++; continue; }
      const d = r.detail;
      const good = !d.blocked && !d.dead && (d.body || (d.images || []).length);
      const dup = seenTitles.has(d.title || '');
      if (d.title) seenTitles.add(d.title);
      if (good && !dup) ok++; else bad++;
      console.log(`${good && !dup ? '✓' : '✗'} 卡片=「${(it.title || '').slice(0, 24)}」 → 打开=「${(d.title || '(空)').slice(0, 30)}」${dup ? ' [重复]' : ''}`);
      console.log(`    body=${(d.body || '').length}字 | 图${(d.images || []).length} | 评论${(d.comments || []).length} | 目标=${r.target.tag}.${r.target.cls}`);
      await sleep(2000 + Math.random() * 1500);
    }
    console.log(`\n结果：成功 ${ok} 篇 / 失败 ${bad} 篇`);
  } finally { c.close(); }
}
