// crawler.mjs — continuous discovery + detail fetching. Never idles, paces itself.
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { KB, freshnessScore, num } from './kb.mjs';
import { downloadImages } from './imgfetch.mjs';
import { connect, searchPage, noteDetail, sleep } from './core.mjs';
import { openNoteByOsClick, openNoteByClick, closeNote, domCardIds, scrollFeed, isFreshCard } from './click-read.mjs';
import { CONFIG } from './config.mjs';

const ROOT = CONFIG.workspace;
const PROFILE = CONFIG.profileDir;
const EDGE_EXE = CONFIG.browserExe;
const PORT = CONFIG.port;
const LOG = join(ROOT, 'crawl.log');

// Broad sweep of angles so the knowledge base keeps growing.
export const KEYWORDS = [
  // 10/4 当天的长尾（时效最高）
  'REDLAND 10月4日', 'redland 今日实况', 'REDLAND 10月4日 无料', 'REDLAND 10月4日 时间表',
  'REDLAND 10月4日 攻略', 'REDLAND 月光舞台', 'REDLAND 4号 搭子', 'REDLAND 10月5日',
  'REDLAND 4号 无料', 'REDLAND 4号 互换', 'REDLAND 4号 排队', 'REDLAND 4号 天气',
  'REDLAND 4号 预约', 'REDLAND 4号 集pin', 'REDLAND 明天 攻略', 'REDLAND 明天 无料',
  'REDLAND 日光舞台', 'REDLAND 花车 巡游 4号', 'REDLAND 宝可梦 4号', 'REDLAND 崩铁 无料',
  'REDLAND 光夜 无料', 'REDLAND 世外 无料', 'REDLAND 如鸢 4号', 'REDLAND 第五人格 攻略',
  'REDLAND 展位 无料 一览', 'REDLAND coser 4号', 'REDLAND 痛包', 'REDLAND 互换 无料',
  'REDLAND 票 转', 'REDLAND 现场 雨', 'REDLAND 排队 实况', 'REDLAND 集章 攻略',
  // 通用攻略面
  'REDLAND 2026 攻略', 'REDLAND 攻略 避坑', 'REDLAND 集pin 攻略', 'REDLAND 无料 领取',
  'REDLAND 展位 情报', 'REDLAND 地图 分区', 'REDLAND 入场 接驳车', 'REDLAND 官方 攻略',
  'REDLAND 排队 时间', 'REDLAND pin 兑换 冰箱贴', 'REDLAND 花车 巡游 时间', 'REDLAND 音乐会 演出',
  'REDLAND 必带 清单', 'REDLAND 盖章 打卡', 'REDLAND 周边 值得买', 'REDLAND 攻略 总结',
  'REDLAND 门票 入场', 'REDLAND 值不值得去', 'REDLAND 新手 攻略', 'REDLAND 集章 领取点',
];
const SORTS = ['latest', 'latest', 'general', 'latest', 'popular'];

const DETAIL_GAP_MS = Number(process.env.XHS_DETAIL_GAP_MS || 90000);
const SEARCH_GAP_MS = Number(process.env.XHS_SEARCH_GAP_MS || 60000);
// After a 安全限制 redirect: go back home (which works), then stay away for a long while.
const BLOCK_COOLDOWN_MS = Number(process.env.XHS_BLOCK_COOLDOWN_MS || 20 * 60 * 1000);
const RECYCLE_WAIT_MS = Number(process.env.XHS_RECYCLE_WAIT_MS || 8 * 60 * 1000);
// Hard budget so a long run can never repeat the 15:45 burst (≈100 requests in 30 min).
const MAX_DETAILS_PER_HOUR = Number(process.env.XHS_MAX_DETAILS_PER_HOUR || 55);
const MAX_SEARCHES_PER_HOUR = Number(process.env.XHS_MAX_SEARCHES_PER_HOUR || 16);
const WARMUP_DETAILS = Number(process.env.XHS_WARMUP_DETAILS || 6);

const now = () => new Date();
const stamp = () => now().toLocaleString('zh-CN', { hour12: false });
let HEART = { phase: 'boot' };
function beat(patch) {
  HEART = { ...HEART, ...patch, updatedAt: stamp() };
  try { writeFileSync(join(ROOT, 'heartbeat.json'), JSON.stringify(HEART, null, 1), 'utf8'); } catch {}
}
function log(m) {
  const line = `[${stamp()}] ${m}`;
  console.log(line);
  try { appendFileSync(LOG, line + '\n', 'utf8'); } catch {}
}

async function cdpAlive() {
  try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(5000) })).ok; }
  catch { return false; }
}
async function ensureBrowser() {
  if (await cdpAlive()) return true;
  log('browser down — relaunching isolated Edge with the saved profile');
  try {
    spawn(EDGE_EXE, [
      `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', `--user-data-dir=${PROFILE}`,
      '--no-first-run', '--no-default-browser-check', '--disable-sync',
      '--window-size=1300,900', '--window-position=80,40', 'https://www.xiaohongshu.com/explore',
    ], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) { log('spawn failed: ' + e.message); }
  for (let i = 0; i < 12; i++) { await sleep(5000); if (await cdpAlive()) return true; }
  return false;
}

/** Priority: fresh 10/2-10/3 field reports first, then most-liked unknowns. */
function rankCard(card) {
  const pseudo = { title: card.title, body: '', date: '' };
  return freshnessScore(pseudo) * 100000 + num(card.likedCount);
}

/** Did the site push back? (安全限制 interstitial, or a note page that yielded nothing) */
function isBlocked(detail) {
  const t = `${detail.title || ''}`;
  if (/安全限制|访问频繁|操作过于频繁|请稍后再试/.test(t)) return true;
  if (detail.body === '' && (!detail.images || detail.images.length === 0)) return true;
  return false;
}

export async function runCrawler({ maxNotes = Infinity, deadlineMs = 0, onNote } = {}) {
  mkdirSync(join(ROOT, 'kb'), { recursive: true });
  const kb = new KB(join(ROOT, 'kb'));
  log(`crawler start — kb has ${kb.noteCount()} notes / ${kb.commentCount()} comments`);

  const todo = new Map();     // id -> card (never-fetched notes)
  const recheck = new Map();  // id -> card (fetched before, but engagement grew)
  const blockedIds = new Set(); // notes that hit the interstitial — do not retry
  const queue = [];           // keyword indices pending
  let kwIdx = 0;
  let detailCount = 0;
  let searchCount = 0;
  let skipCount = 0;
  let lastSearchAt = 0;
  let consecutiveBlocks = 0;
  let cooldownUntil = 0;
  let cooldownLevel = 0;
  const hourLog = [];        // timestamps of recent requests, for the hourly budget
  const gateHits = [];       // searches that came back behind the login/paywall gate

  /** Sliding-window budget check. Returns ms to wait, or 0 when there is room. */
  const budgetWait = (kind) => {
    const nowT = Date.now();
    while (hourLog.length && nowT - hourLog[0].ts > 3600_000) hourLog.shift();
    const used = hourLog.filter((e) => e.kind === kind).length;
    const cap = kind === 'detail' ? MAX_DETAILS_PER_HOUR : MAX_SEARCHES_PER_HOUR;
    if (used < cap) return 0;
    const oldest = hourLog.find((e) => e.kind === kind);
    return Math.max(0, 3600_000 - (nowT - oldest.ts)) + 5000;
  };
  const spend = (kind) => hourLog.push({ kind, ts: Date.now() });

  /** Gentle ramp-up after a cooldown: the first few notes get extra spacing. */
  const rampGap = (detailIdx) => (detailIdx < WARMUP_DETAILS ? DETAIL_GAP_MS * 2 : DETAIL_GAP_MS);

  const stop = () => {
    if (deadlineMs && Date.now() > deadlineMs) return true;
    // maxNotes counts opened notes; when it is 0 we stay in search-only mode and run until the deadline
    if (maxNotes > 0 && detailCount >= maxNotes) return true;
    return false;
  };
  const searchOnly = maxNotes === 0;

  /** Only re-fetch a known note when the card says there is more engagement than we stored. */
  const shouldRecheck = (card) => {
    const known = kb.get(card.id);
    if (!known) return true;                                  // brand new → always fetch
    if ((known.fetchCount || 1) >= 3) return false;            // stop after 3 looks
    const cardComments = Number(String(card.commentCount || 0).replace(/\D/g, '')) || 0;
    const haveComments = (known.comments || []).length;
    if (cardComments > haveComments) return true;              // new comments appeared
    const cardLikes = num(card.likedCount);
    if (cardLikes > num(known.likes) * 1.25) return true;      // engagement jumped
    return false;
  };

  for (let round = 0; !stop(); round++) {
    // ---------- search phase ----------
    if (queue.length === 0) {
      kwIdx = (kwIdx + 1) % KEYWORDS.length;
      queue.push(kwIdx);
    }
    const kwi = queue.shift();
    const keyword = KEYWORDS[kwi];
    const sort = SORTS[searchCount % SORTS.length];

    if (!(await ensureBrowser())) { log('no browser, waiting 60s'); await sleep(60000); continue; }

    let c = null;
    let res = { items: [], gate: false };
    try {
      c = await connect(PORT);
      res = await searchPage(c, keyword, sort, { scroll: searchCount % 2 === 0 });
      searchCount++;
      lastSearchAt = Date.now();
      if (res.gate) {
        log('WARN search gate — login may have expired');
        beat({ phase: 'login-lost', message: '搜索需要登录，请重新扫码' });
      }
      let fresh = 0, requeued = 0;
      for (const it of res.items) {
        if (!it.xsecToken) continue;
        const known = kb.get(it.id);
        if (!known) {
          if (!todo.has(it.id)) { todo.set(it.id, it); fresh++; }
          // store the search card itself: title / engagement / cover need no note request
          kb.upsertNote(it, {
            title: it.title, body: '', author: it.author, likes: it.likedCount,
            collects: it.collectedCount, tags: [], images: [],
          }, keyword);
        } else {
          if (!known.xsecToken) known.xsecToken = it.xsecToken;
          if (!known.cover && it.cover) known.cover = it.cover;
          if (shouldRecheck(it)) { recheck.set(it.id, it); requeued++; }
        }
      }
      kb.addSearch({ at: new Date().toISOString(), keyword, sort, gate: res.gate, found: res.items.length, newCards: fresh, requeued });
      kb.flush();

      // Covers are free: the search card already carries the image URL, no note request needed.
      try {
        const coverJobs = res.items.filter((it) => it.cover).slice(0, 12)
          .map((it) => ({ name: `${it.id}.jpg`, url: it.cover }));
        if (coverJobs.length) {
          const cr = await downloadImages(join(ROOT, 'kb', 'img'), coverJobs);
          log(`  covers ${cr.ok}/${cr.total} 张（来自搜索卡片，零风控成本）`);
        }
      } catch {}

      log(`search #${searchCount} "${keyword}" (${sort}) → ${res.items.length} cards, ${fresh} new, ${requeued} recheck, todo=${todo.size}`);
      beat({
        phase: 'crawling', searches: searchCount, details: detailCount,
        kbNotes: kb.noteCount(), kbComments: kb.commentCount(), todo: todo.size, recheck: recheck.size,
        lastKeyword: keyword,
        message: `已搜 ${searchCount} 个关键词 / 深读 ${detailCount} 篇 / 知识库 ${kb.noteCount()} 篇 · ${kb.commentCount()} 条评论`,
      });
    } catch (e) {
      log('search error: ' + e.message);
      queue.push(kwi);
      await sleep(15000);
    }

    // ---------- detail phase ----------
    // The results list is virtualised: only ~30 of the ~66 cards exist in the DOM.
    // Read strictly those; scroll once to render a few more. Off-page notes stay queued.
    let rendered = new Set(await domCardIds(c));
    // Only the last couple of days matter: keep the crawl on fresh posts.
    const pickable = () => (res.items || []).filter((it) => it.xsecToken && todo.has(it.id) && rendered.has(it.id) && isFreshCard(it));
    let batch = pickable().slice(0, 4);
    if (batch.length < 2) {
      await scrollFeed(c, 1100);
      rendered = new Set(await domCardIds(c));
      batch = pickable().slice(0, 4);
    }
    const recheckBatch = batch.length < 2
      ? (res.items || []).filter((it) => recheck.has(it.id) && it.xsecToken && rendered.has(it.id)).slice(0, 2 - batch.length)
      : [];
    if (!batch.length && !recheckBatch.length) {
      log(`  本页 DOM 内没有可读的新卡片（渲染 ${rendered.size} 张，队列 ${todo.size} 篇），继续下一轮搜索`);
    }
    if (searchOnly) continue;   // 纯搜索模式：卡片与封面照收，不开笔记

    try {
    for (const card of [...batch, ...recheckBatch]) {
      if (stop()) break;
      if (!card.xsecToken) { todo.delete(card.id); recheck.delete(card.id); continue; }
      if (blockedIds.has(card.id)) { todo.delete(card.id); recheck.delete(card.id); continue; }

      // ---- cooldown: keep searching (cheap, never blocked) but stop opening notes ----
      if (Date.now() < cooldownUntil) {
        log(`cooldown: 本轮不开笔记，剩 ${Math.ceil((cooldownUntil - Date.now()) / 60000)} 分钟`);
        beat({ phase: 'cooldown', cooldownSec: Math.round((cooldownUntil - Date.now()) / 1000),
               message: `详情限流降温中（剩 ${Math.ceil((cooldownUntil - Date.now()) / 60000)} 分钟）｜仅搜索采卡片｜知识库 ${kb.noteCount()} 篇` });
        break;
      }

      const sinceSearch = Date.now() - lastSearchAt;
      if (sinceSearch < SEARCH_GAP_MS) await sleep(SEARCH_GAP_MS - sinceSearch);

      try {
        // Genuine OS-level click first — it survives the anti-bot check.
        // A failed click means "skip this note"; never fall back to URL navigation.
        let clicked = await openNoteByOsClick(c, card.id, { attempts: 2 });
        let via = '系统鼠标';
        if (!clicked.ok) {
          clicked = await openNoteByClick(c, card.id, { attempts: 1 });
          via = '浏览器事件';
        }
        if (!clicked.ok) {
          skipCount++;
          log(`  SKIP ${card.id} (${clicked.reason}) ${clicked.diag ? JSON.stringify(clicked.diag).slice(0, 200) : ''}`);
          await closeNote(c);
          await sleep(4000 + Math.random() * 3000);
          continue;
        }
        const detail = clicked.detail;
        await closeNote(c);

        if (isBlocked(detail)) {
          consecutiveBlocks++;
          blockedIds.add(card.id);
          todo.delete(card.id);
          recheck.delete(card.id);
          log(`  BLOCKED x${consecutiveBlocks}: ${card.id} (${(card.title || '').slice(0, 30)})`);
          // The block only redirects this tab; home still works. Go home, then stay away.
          if (consecutiveBlocks >= 2) {
            cooldownLevel = Math.min(3, cooldownLevel + 1);
            cooldownUntil = Date.now() + BLOCK_COOLDOWN_MS * cooldownLevel;
            consecutiveBlocks = 0;
            const mins = Math.round((cooldownUntil - Date.now()) / 60000);
            log(`  → 详情接口限流，暂停 ${mins} 分钟（第 ${cooldownLevel} 级；期间只做搜索，不开笔记）`);
            beat({ phase: 'cooldown', cooldownSec: Math.round((cooldownUntil - Date.now()) / 1000),
                   message: `详情被限流，暂停开笔记 ${mins} 分钟（搜索继续，卡片数据仍在收集）` });
            try {
              await c.rpc('Page.navigate', { url: 'https://www.xiaohongshu.com/explore' });
              await sleep(4000);
            } catch {}
          }
          continue;
        }
        consecutiveBlocks = 0;
        cooldownLevel = Math.max(0, cooldownLevel - 1); // sustained success walks the backoff down

        if (detail.images && detail.images.length) {
          await downloadImages(join(ROOT, 'kb', 'img'), [{ name: `${card.id}.jpg`, url: detail.images[0] }]);
        }
        const action = kb.upsertNote(card, detail, keyword);
        detailCount++;
        kb.flush();
        log(`  detail ${detailCount} [${via}/${action}]: ${(detail.title || card.title || '').slice(0, 40)} | 正文${(detail.body || '').length}字 imgs=${(detail.images || []).length} comments=${(detail.comments || []).length}`);
        if (onNote) onNote(kb.get(card.id), keyword);
        todo.delete(card.id);
        recheck.delete(card.id);
        beat({
          phase: 'crawling', searches: searchCount, details: detailCount,
          kbNotes: kb.noteCount(), kbComments: kb.commentCount(), todo: todo.size, recheck: recheck.size,
          lastNote: (detail.title || '').slice(0, 60), lastVia: via,
          message: `已搜 ${searchCount} 个关键词 / 深读 ${detailCount} 篇 / 知识库 ${kb.noteCount()} 篇 · ${kb.commentCount()} 条评论`,
        });
      } catch (e) {
        log('  detail error ' + card.id + ': ' + e.message);
      }

      await sleep(rampGap(detailCount));
    }
    } finally { if (c) c.close(); }

    await sleep(3000);
    if (round % 20 === 0) kb.flush(true);
  }

  kb.flush(true);
  log(`crawler stop — kb ${kb.noteCount()} notes / ${kb.commentCount()} comments / ${kb.imageCount()} image refs`);
  return { notes: kb.noteCount(), comments: kb.commentCount(), searches: searchCount, details: detailCount };
}
