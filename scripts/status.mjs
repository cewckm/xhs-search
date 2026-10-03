// status.mjs — one-shot snapshot of the isolated window's state.
import { connect } from './core.mjs';

const c = await connect(9222);
try {
  const raw = await c.evalJs(`(() => {
    const txt = document.body ? document.body.innerText : '';
    const cards = Array.from(document.querySelectorAll('section.note-item'));
    const visible = cards.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length;
    const rendered = cards.filter((el) => el.getBoundingClientRect().width > 0
      && el.getBoundingClientRect().top < innerHeight * 2
      && el.getBoundingClientRect().bottom > -innerHeight).length;
    return JSON.stringify({
      url: location.href.slice(0, 100),
      title: document.title,
      restricted: /安全限制/.test(txt),
      detailPanelOpen: !!document.querySelector('#detail-title'),
      cardsTotal: cards.length,
      cardsVisible: visible,
      cardsNearViewport: rendered,
      firstText: txt.slice(0, 120).replace(/\\n/g, ' | '),
    }, null, 1);
  })()`);
  console.log(raw);
} finally { c.close(); }
