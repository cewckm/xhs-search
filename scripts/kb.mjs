// kb.mjs — the accumulating knowledge base: every note and comment ever fetched.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** comments must always be an array of objects, even if a caller passes a count. */
function normComments(v) {
  if (Array.isArray(v)) return v.filter((c) => c && typeof c === 'object');
  return [];
}

export class KB {
  constructor(root) {
    this.root = root;
    mkdirSync(root, { recursive: true });
    this.notesFile = join(root, 'notes.json');
    this.searchesFile = join(root, 'searches.json');
    this.notes = existsSync(this.notesFile) ? JSON.parse(readFileSync(this.notesFile, 'utf8')) : {};
    this.searches = existsSync(this.searchesFile) ? JSON.parse(readFileSync(this.searchesFile, 'utf8')) : [];
    this.dirty = false;
  }

  has(id) { return !!this.notes[id]; }
  get(id) { return this.notes[id]; }
  size() { return Object.keys(this.notes).length; }

  noteCount() { return Object.keys(this.notes).length; }
  commentCount() {
    let n = 0;
    for (const k of Object.keys(this.notes)) n += (this.notes[k].comments || []).length;
    return n;
  }
  imageCount() {
    let n = 0;
    for (const k of Object.keys(this.notes)) n += (this.notes[k].images || []).length;
    return n;
  }

  /** Add or refresh one note. Keeps firstSeen, tracks updates, merges new comments. */
  upsertNote(card, detail, keyword) {
    const id = card.id;
    const existing = this.notes[id];
    const nowIso = new Date().toISOString();
    const incoming = normComments(detail.comments);
    if (!existing) {
      this.notes[id] = {
        id,
        xsecToken: card.xsecToken || null,
        sourceKeyword: keyword || null,
        sourceLikes: card.likedCount || null,
        firstSeen: nowIso,
        lastFetched: nowIso,
        fetchCount: 1,
        title: detail.title || card.title || '',
        body: detail.body || '',
        author: detail.author || card.author || '',
        date: detail.date || null,
        ipLocation: detail.ipLocation || null,
        likes: detail.likes || card.likedCount || null,
        collects: detail.collects || null,
        commentCount: typeof detail.comments === 'string' ? detail.comments : null,
        tags: detail.tags || [],
        images: detail.images && detail.images.length ? detail.images : (card.cover ? [card.cover] : []),
        cover: card.cover || null,
        detailOk: detail.detailOk !== false,
        comments: incoming,
        commentKeys: incoming.map((c) => (c.text || '').slice(0, 30)),
      };
      this.dirty = true;
      return 'new';
    }
    // refresh: engagement, body, and append genuinely new comments
    existing.lastFetched = nowIso;
    existing.fetchCount = (existing.fetchCount || 1) + 1;
    existing.likes = detail.likes || existing.likes;
    existing.collects = detail.collects || existing.collects;
    if (typeof detail.comments === 'string') existing.commentCount = detail.comments;
    if (detail.body && detail.body.length > (existing.body || '').length) existing.body = detail.body;
    if (detail.date) existing.date = detail.date;
    if (detail.ipLocation) existing.ipLocation = detail.ipLocation;
    if (detail.images && detail.images.length > (existing.images || []).length) existing.images = detail.images;
    if (!existing.cover && card.cover) existing.cover = card.cover;
    existing.comments = normComments(existing.comments);
    const keys = new Set(existing.commentKeys || []);
    let added = 0;
    for (const c of incoming) {
      const k = (c.text || '').slice(0, 30);
      if (!keys.has(k)) { existing.comments.push(c); keys.add(k); added++; }
    }
    existing.commentKeys = Array.from(keys);
    existing.newComments = (existing.newComments || 0) + added;
    if (added) existing.lastCommentAt = nowIso;
    this.dirty = true;
    return added ? 'updated+' + added : 'refreshed';
  }

  addSearch(rec) {
    this.searches.push(rec);
    if (this.searches.length > 4000) this.searches = this.searches.slice(-3000);
    this.dirty = true;
  }

  /** New notes (and new comments) since a timestamp — the material for one report. */
  newSince(iso) {
    const t = new Date(iso).getTime();
    const notes = [], commentNotes = [];
    for (const k of Object.keys(this.notes)) {
      const n = this.notes[k];
      if (new Date(n.firstSeen).getTime() >= t) notes.push(n);
      else if (n.lastCommentAt && new Date(n.lastCommentAt).getTime() >= t) commentNotes.push(n);
    }
    return { notes, commentNotes };
  }

  byLikes(limit = 0) {
    const all = Object.keys(this.notes).map((k) => this.notes[k])
      .sort((a, b) => num(b.likes) - num(a.likes));
    return limit ? all.slice(0, limit) : all;
  }

  flush(force = false) {
    if (!this.dirty && !force) return;
    writeFileSync(this.notesFile, JSON.stringify(this.notes), 'utf8');
    writeFileSync(this.searchesFile, JSON.stringify(this.searches), 'utf8');
    this.dirty = false;
  }

  /** Notes that carry content — search cards (title + cover) count too, not just full reads. */
  validList() {
    return Object.keys(this.notes)
      .map((k) => this.notes[k])
      .filter((n) => !/安全限制|访问频繁|操作过于频繁/.test(n.title || '')
        && ((n.body && n.body.length > 0) || (n.images || []).length > 0 || (n.cover && n.title)));
  }

  /** Mark a fetch as a rate-limit hit so it never pollutes reports. */
  markBlocked(id) {
    const n = this.notes[id];
    if (n) { n.blocked = true; this.dirty = true; }
  }

  /** Flat list for the report generator. */
  exportAll() {
    return Object.keys(this.notes).map((k) => this.notes[k]);
  }
}

export function num(v) {
  if (v === null || v === undefined) return 0;
  const m = String(v).trim().match(/([\d.]+)\s*([万亿]?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (m[2] === '万') n *= 10000;
  else if (m[2] === '亿') n *= 100000000;
  return Math.round(n);
}

/** Is this note about the live 10/2-10/3 window (or otherwise fresh)? */
export function freshnessScore(n) {
  const hay = `${n.title || ''} ${n.body || ''} ${n.date || ''}`;
  let s = 0;
  if (/10\s*[-./月]\s*0?3|10月3|第\s*[三3]\s*天|day\s*3/i.test(hay)) s += 3;
  if (/10\s*[-./月]\s*0?2|10月2|第\s*[二2]\s*天|day\s*2|首日/i.test(hay)) s += 3;
  if (/小时前|刚刚|编辑于\s*\d+\s*小时前/.test(n.date || '')) s += 2;
  if (/昨天/.test(n.date || '')) s += 1;
  if (/攻略|避坑|必看|提醒|汇总|情报|地图|pin|PIN|无料|领取/i.test(hay)) s += 1;
  return s;
}
