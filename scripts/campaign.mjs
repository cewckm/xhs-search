// campaign.mjs — the orchestrator: OS-level clicking crawler + a report every N minutes.
import { mkdirSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { runCrawler } from './crawler.mjs';
import { browserPid, windowRect, focusWindow, loadCalibration } from './osclick.mjs';
import { CONFIG } from './config.mjs';

const ROOT = CONFIG.workspace;
const REPORTS = CONFIG.reportsDir;
const PY = CONFIG.python;
const LOG = join(ROOT, 'campaign.log');
const END_HOUR = Number(process.env.XHS_END_HOUR || 22);
const REPORT_EVERY_MIN = Number(process.env.XHS_REPORT_MIN || 20);

const now = () => new Date();
const stamp = () => now().toLocaleString('zh-CN', { hour12: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(m) {
  const line = `[${stamp()}] ${m}`;
  console.log(line);
  try { appendFileSync(LOG, line + '\n', 'utf8'); } catch {}
}
function endTime() { const e = new Date(); e.setHours(END_HOUR, 0, 0, 0); if (e <= now()) e.setDate(e.getDate() + 1); return e; }
function saveState(o) { try { writeFileSync(join(ROOT, 'status.json'), JSON.stringify(o, null, 1), 'utf8'); } catch {} }

function genReport(idx, sinceIso) {
  return new Promise((resolve) => {
    execFile(PY, [join(ROOT, 'synthesize.py'), String(idx), sinceIso, new Date().toISOString()],
      { timeout: 300000, encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 },
      (err, stdout) => {
        if (err) log(`report ${idx} FAILED: ${String(err.message).slice(0, 200)}`);
        else log(`report ${idx}: ${String(stdout).trim().split('\n').slice(-1)[0]}`);
        resolve();
      });
  });
}

const main = async () => {
  mkdirSync(REPORTS, { recursive: true });

  // refresh calibration for the current window position
  const pid = await browserPid();
  const rect = windowRect(pid);
  const cal = loadCalibration();
  log(`window pid=${pid} rect=${JSON.stringify(rect)} calibration=${JSON.stringify(cal)}`);
  if (!cal) { log('WARN 没有校准数据，请先运行 node calibrate2.mjs'); }
  focusWindow(pid);
  await sleep(800);

  const deadline = endTime().getTime();
  log(`CAMPAIGN START — 系统级点击采集直到 ${endTime().toLocaleString('zh-CN', { hour12: false })}，每 ${REPORT_EVERY_MIN} 分钟一份报告`);

  let running = true;
  // never overwrite an existing report: continue numbering after the highest one present
  const existing = readdirSync(REPORTS).filter((d) => /^cycle-\d+$/.test(d))
    .map((d) => Number(d.replace('cycle-', '')));
  let published = existing.length ? Math.max(...existing) : 0;
  const startAt = published;
  log(`已有报告编号到 cycle-${String(startAt).padStart(2, '0')}，本轮从 cycle-${String(startAt + 1).padStart(2, '0')} 开始`);
  let since = new Date().toISOString();

  // crawler runs in bursts so a report slot is never blocked for long
  const crawlLoop = (async () => {
    while (running && Date.now() < deadline) {
      const burstEnd = Math.min(Date.now() + 6 * 60 * 1000, deadline);
      try {
        const s = await runCrawler({ deadlineMs: burstEnd });
        log(`burst done: ${JSON.stringify(s)}`);
      } catch (e) {
        log('burst error: ' + e.message);
        await sleep(15000);
      }
    }
  })();

  // report loop
  const reportLoop = (async () => {
    let next = new Date(Date.now() + 60 * 1000);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + (REPORT_EVERY_MIN - (next.getMinutes() % REPORT_EVERY_MIN)) % REPORT_EVERY_MIN);
    while (Date.now() < deadline) {
      const wait = next - now();
      if (wait > 0) await sleep(wait);
      if (now() >= deadline) break;
      await genReport(++published, since);
      since = new Date().toISOString();
      saveState({ phase: 'running', reportsPublished: published, lastReportAt: since, updatedAt: stamp() });
      next = new Date(next.getTime() + REPORT_EVERY_MIN * 60000);
    }
  })();

  await Promise.all([crawlLoop, reportLoop]);
  running = false;
  log(`CAMPAIGN DONE — 共发布 ${published} 份报告`);
  saveState({ phase: 'finished', reportsPublished: published, finishedAt: stamp() });
};

main().catch((e) => log('FATAL ' + e.message));
