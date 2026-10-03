// imgfetch.mjs — image downloader that guarantees real JPEG output.
// Xiaohongshu's CDN serves WebP even for .jpg-looking URLs, which python-docx cannot embed,
// so every download is sniffed and transcoded when needed.
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONFIG } from './config.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0';
const PY = CONFIG.python;
const TOJPG = join(CONFIG.scriptsDir, 'tojpg.py');

// Ask the CDN for a JPEG variant when the URL carries a webp format suffix.
export function jpegVariant(url) {
  if (/webp/i.test(url)) return url.replace(/webp_(\d+)/i, '$1').replace(/webp/i, 'jpg');
  return url;
}

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp') return 'avif';
  return 'unknown';
}

export async function downloadImages(outDir, jobs, { verbose = false } = {}) {
  mkdirSync(outDir, { recursive: true });
  let ok = 0;
  const failures = [];
  for (const job of jobs) {
    const dest = join(outDir, job.name);
    if (existsSync(dest)) { ok++; continue; }
    let got = false;
    let lastErr = null;
    for (const url of [jpegVariant(job.url), job.url]) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, Referer: 'https://www.xiaohongshu.com/', Accept: 'image/jpeg,image/png,image/webp,*/*' },
          redirect: 'follow',
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) { lastErr = 'http ' + res.status; continue; }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 1500) { lastErr = 'too small'; continue; }
        const kind = sniff(buf);
        if (kind === 'jpeg' || kind === 'png') {
          writeFileSync(dest, buf);
          got = true; break;
        }
        const tmp = dest + '.tmp';
        writeFileSync(tmp, buf);
        try {
          execFileSync(PY, [TOJPG, tmp, dest], { timeout: 60000, stdio: 'ignore' });
          unlinkSync(tmp);
          if (existsSync(dest)) { got = true; break; }
          lastErr = 'transcode produced nothing';
        } catch (e) {
          try { unlinkSync(tmp); } catch {}
          lastErr = 'transcode failed: ' + e.message.slice(0, 60);
        }
      } catch (e) {
        lastErr = e.message.slice(0, 60);
      }
    }
    if (got) ok++;
    else failures.push({ name: job.name, error: lastErr });
  }
  if (verbose) failures.forEach((f) => console.log('  img fail: ' + JSON.stringify(f)));
  return { ok, total: jobs.length, failures };
}
