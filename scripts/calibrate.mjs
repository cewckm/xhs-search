// calibrate2.mjs — self-verifying calibration: click real sidebar links and check the URL changes.
import { connect } from './core.mjs';
import { browserPid, windowRect, focusWindow, osClick, saveCalibration, loadCalibration } from './osclick.mjs';

const c = await connect(9222);
const url = async () => await c.evalJs('location.href');
try {
  const pid = await browserPid();
  const rect = windowRect(pid);
  console.log('窗口:', JSON.stringify(rect));
  focusWindow(pid);
  await new Promise((r) => setTimeout(r, 900));

  // make sure we start on a page with the sidebar visible
  await c.rpc('Page.navigate', { url: 'https://www.xiaohongshu.com/explore' });
  await new Promise((r) => setTimeout(r, 6500));

  const targets = JSON.parse(await c.evalJs(`(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href], .side-bar a, #global a')) {
      const r = a.getBoundingClientRect();
      if (r.width < 40 || r.height < 20 || r.top < 0 || r.left < 0) continue;
      const href = a.getAttribute('href');
      if (!href || href === '#' || href.startsWith('javascript')) continue;
      out.push({ href, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), text: (a.innerText || '').trim().slice(0, 12) });
      if (out.length >= 12) break;
    }
    return JSON.stringify(out);
  })()`));
  console.log(`找到 ${targets.length} 个可点目标`);
  const t = targets.find((x) => x.w > 60 && x.y > 60) || targets[0];
  console.log('靶子:', JSON.stringify(t));

  const prev = loadCalibration();
  const candidates = [];
  if (prev) candidates.push({ left: prev.left, top: prev.top, tag: '上次' });
  for (const dy of [77, 85, 92, 100, 110, 120]) candidates.push({ left: rect.left + 8, top: rect.top + dy, tag: `+8/${dy}` });

  let found = null;
  for (const o of candidates) {
    const before = await url();
    const pt = osClick(t.x, t.y, o);
    await new Promise((r) => setTimeout(r, 2600));
    const after = await url();
    const changed = before !== after;
    console.log(`原点 ${o.tag} → 屏幕(${pt.x},${pt.y}) | URL变化=${changed} ${changed ? '✅ 命中' : ''}`);
    if (changed) { found = o; break; }
    await c.rpc('Page.navigate', { url: 'https://www.xiaohongshu.com/explore' });
    await new Promise((r) => setTimeout(r, 5000));
  }

  if (found) {
    saveCalibration({ left: found.left, top: found.top, calibratedAt: new Date().toISOString(), method: found.tag, pid });
    console.log('\n✅ 校准完成并保存:', JSON.stringify(found));
  } else {
    console.log('\n❌ 全部候选偏移都未命中，需要手动指定');
  }
} finally { c.close(); }
