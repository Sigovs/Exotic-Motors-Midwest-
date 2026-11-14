/* Exotic Motors Midwest: motion layer.
 *
 * Idea: the studio rises. Every entrance travels one way, upward.
 *  - Titles climb out of masked lines as a staircase, one rung per line.
 *  - Photographs come up from the floor under a lifting shutter while they settle from 1.08.
 *  - The scroll pulls the step cards up as stairs that level out (CSS scroll-driven, see index.html).
 *
 * Methods: WAAPI for entrances (lines have to be measured, so CSS alone cannot stagger them),
 * CSS scroll-driven animations for everything scrubbed, with a rAF fallback that writes --p.
 * Durations and easings come from the --m-* tokens in :root.
 *
 * Content never depends on this file. Hidden states exist only while <html> has .js-motion,
 * which <head> sets only when motion is allowed and removes again if this file does not
 * report in with .m-ready.
 */
(() => {
  'use strict';
  const root = document.documentElement;
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const tok = (n) => getComputedStyle(root).getPropertyValue(n).trim();
  const tms = (n) => parseFloat(tok(n)) || 0;
  const wait = (t) => new Promise((r) => setTimeout(r, t));

  // cubic-bezier token -> easing function (shutter keyframes, rail glide, scroll fallback)
  const bezier = (str) => {
    const m = /cubic-bezier\(([^)]+)\)/.exec(str);
    const [x1, y1, x2, y2] = m ? m[1].split(',').map(Number) : [0.25, 0.1, 0.25, 1];
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = (t) => ((ax * t + bx) * t + cx) * t;
    const Y = (t) => ((ay * t + by) * t + cy) * t;
    const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const e = X(t) - x;
        if (Math.abs(e) < 1e-6) return Y(t);
        const d = dX(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      let lo = 0, hi = 1;
      t = x;
      for (let i = 0; i < 40; i++) {
        const v = X(t);
        if (Math.abs(v - x) < 1e-6) break;
        if (v < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return Y(t);
    };
  };

  /* ---- rail glide: exposed even when entrances are off; reduced motion makes it instant ---- */
  let glideRAF = 0;
  const glideStop = new WeakSet();
  window.emGlide = (el, to) => {
    cancelAnimationFrame(glideRAF);
    const from = el.scrollLeft, d = to - from;
    if (rm.matches || Math.abs(d) < 1) {
      el.style.scrollSnapType = '';
      el.scrollTo({ left: to, behavior: 'instant' });
      return;
    }
    if (!glideStop.has(el)) {
      // the visitor's own hand always wins over a running glide
      const stop = () => { cancelAnimationFrame(glideRAF); el.style.scrollSnapType = ''; };
      ['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach((t) => el.addEventListener(t, stop, { passive: true }));
      glideStop.add(el);
    }
    const dur = tms('--m-page'), ease = bezier(tok('--m-ease-glide')), t0 = performance.now();
    el.style.scrollSnapType = 'none';
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.scrollLeft = from + d * ease(p);
      if (p < 1) glideRAF = requestAnimationFrame(step);
      else el.style.scrollSnapType = '';
    };
    glideRAF = requestAnimationFrame(step);
  };

  if (!root.classList.contains('js-motion')) return;

  try { // any failure below hands the page back fully visible
  /* ---- registry: everything running can be brought to its final, still state at once ---- */
  const live = new Set();
  const once = (fn) => { let done = false; return () => { if (!done) { done = true; fn(); } }; };

  /* ---- line splitter: words grouped by rendered line, each line in its own mask ---- */
  const SPACE = /([ \t\n\r\f]+)/; // not \s: a no-break space keeps "or M" together
  function split(el) {
    const orig = [...el.childNodes];
    const words = [];
    const frag = document.createDocumentFragment();
    let spaced = false;
    for (const node of orig) {
      if (node.nodeType === Node.TEXT_NODE) {
        for (const part of node.data.split(SPACE)) {
          if (!part) continue;
          if (SPACE.test(part)) { spaced = true; frag.append(part); continue; }
          const w = document.createElement('span');
          w.textContent = part;
          w.mSpaced = spaced; spaced = false;
          frag.append(w); words.push(w);
        }
      } else {
        frag.append(node);
        if (node.nodeName === 'BR') { spaced = true; continue; }
        node.mSpaced = spaced; spaced = false;
        words.push(node);
      }
    }
    el.replaceChildren(frag);
    const rows = [];
    let y0 = -Infinity;
    for (const w of words) {
      const y = w.getBoundingClientRect().top;
      if (y - y0 > 4) { rows.push([]); y0 = y; }
      rows[rows.length - 1].push(w);
    }
    const inners = rows.map((row) => {
      const ln = document.createElement('span'); ln.className = 'm-ln';
      const li = document.createElement('span'); li.className = 'm-li';
      row.forEach((w, k) => { if (k && w.mSpaced) li.append(' '); li.append(w); });
      ln.append(li);
      return li;
    });
    el.replaceChildren(...inners.map((li) => li.parentNode));
    return { inners, restore: () => el.replaceChildren(...orig) };
  }

  /* ---- 1. lines rise inside their masks, one rung after another ---- */
  function rise(el, { dur, step, delay = 0, budget = 0, from: fromOpt }) {
    if (!el || el.classList.contains('m-in')) return;
    const s = split(el);
    el.classList.add('m-in');
    const n = s.inners.length;
    if (budget && n > 1) step = Math.min(step, Math.max(0, (budget - delay - dur) / (n - 1)));
    const easing = tok('--m-ease-lift');
    const from = fromOpt || `translateY(${tok('--m-rise-from')})`;
    const anims = s.inners.map((li, k) => li.animate(
      [{ transform: from }, { transform: 'none' }],
      { duration: dur, delay: delay + k * step, easing, fill: 'both' }
    ));
    const end = once(() => { live.delete(end); anims.forEach((a) => a.cancel()); s.restore(); });
    live.add(end);
    Promise.all(anims.map((a) => a.finished)).then(end, () => {});
  }

  /* ---- 2. a segment row rises onto its rule ---- */
  function row(li, delay) {
    if (li.classList.contains('m-in')) return;
    const b = li.firstElementChild;
    li.style.clipPath = 'inset(-2px -16px -2px -16px)';
    li.classList.add('m-in');
    const a = b.animate(
      [{ transform: `translateY(${tok('--m-rise-from')})` }, { transform: 'none' }],
      { duration: tms('--m-row'), delay, easing: tok('--m-ease-lift'), fill: 'both' }
    );
    const end = once(() => { live.delete(end); a.cancel(); li.style.clipPath = ''; });
    live.add(end);
    a.finished.then(end, () => {});
  }

  /* ---- 3. studio shutter: the photo comes up from the floor and settles from 1.08 ----
     The clip is written in the image's own (scaled) space and compensated per keyframe, so the
     visible area never leaves the layout box: no overlap, no overflow, no wrapper needed. */
  function curtain(img, delay = 0) {
    if (img.classList.contains('m-in') || img.mCurtain) return;
    img.mCurtain = true;
    const D = tms('--m-curtain');
    const S0 = parseFloat(tok('--m-curtain-scale')) || 1.08;
    const shut = bezier(tok('--m-ease-shutter'));
    const lift = bezier(tok('--m-ease-lift'));
    const r = parseFloat(getComputedStyle(img).borderTopLeftRadius) || 0;
    const frames = [];
    const N = 40;
    for (let k = 0; k <= N; k++) {
      const p = k / N;
      const c = shut(Math.min(1, p / 0.8));       // the shutter is home at 80%, the settle runs on
      const s = S0 - (S0 - 1) * lift(p);
      const side = ((1 - 1 / s) / 2) * 100;
      const top = (0.5 + (0.5 - c) / s) * 100;
      frames.push({
        offset: p,
        transform: `scale(${s.toFixed(4)})`,
        clipPath: `inset(${top.toFixed(3)}% ${side.toFixed(3)}% ${side.toFixed(3)}% round ${(r / s).toFixed(2)}px)`,
      });
    }
    const t0 = performance.now();
    const loaded = img.complete && img.naturalWidth
      ? Promise.resolve()
      : Promise.race([img.decode().catch(() => {}), wait(700)]);
    loaded.then(() => {
      if (!root.classList.contains('js-motion')) return;
      const a = img.animate(frames, {
        duration: D,
        delay: Math.max(0, delay - (performance.now() - t0)),
        easing: 'linear',
        fill: 'both',
      });
      const end = once(() => { live.delete(end); img.classList.add('m-in'); a.cancel(); });
      live.add(end);
      a.finished.then(end, () => {});
    });
  }

  /* ---- 3b. the closing backdrop is the studio itself, with no frame to wipe: its light comes up
     while it settles from the same 1.08, clipped by its own wrapper ---- */
  function lightUp(img, delay = 0) {
    if (img.classList.contains('m-in') || img.mCurtain) return;
    img.mCurtain = true;
    const S0 = parseFloat(tok('--m-curtain-scale')) || 1.08;
    const loaded = img.complete && img.naturalWidth ? Promise.resolve() : Promise.race([img.decode().catch(() => {}), wait(700)]);
    loaded.then(() => {
      if (!root.classList.contains('js-motion')) return;
      const opts = { duration: tms('--m-curtain'), delay, fill: 'both' };
      const a = img.animate([{ opacity: 0 }, { opacity: 1 }], { ...opts, easing: tok('--m-ease-shutter') });
      const b = img.animate([{ transform: `scale(${S0})` }, { transform: 'none' }], { ...opts, easing: tok('--m-ease-lift') });
      const end = once(() => { live.delete(end); img.classList.add('m-in'); a.cancel(); b.cancel(); });
      live.add(end);
      Promise.all([a.finished, b.finished]).then(end, () => {});
    });
  }

  /* ---- cascade: units in one section queue as rungs on two tracks, words and pictures ---- */
  const cursors = new Map();
  const slot = (key, advance) => {
    const now = performance.now();
    const t = Math.max(now, cursors.get(key) || 0);
    cursors.set(key, t + advance);
    return t - now;
  };
  const textKey = (el) => el.closest('section') || root;
  const sections = $$('section');
  const imgKey = (el) => 'img:' + sections.indexOf(el.closest('section'));

  const units = new Map();
  const unit = (el, play, settle) => { if (el) units.set(el, { play, settle }); };
  const show = (...els) => els.forEach((e) => e && e.classList.add('m-in'));

  // titles: H2s; each title hands the next unit its turn two rungs in
  $$('h2.display').forEach((h) => unit(h, () => {
    const step = tms('--m-line-step');
    rise(h, { dur: tms('--m-line'), step, delay: slot(textKey(h), step * 2) });
  }, () => show(h)));

  // body leads below the hero: a smaller, quicker staircase
  $$('.lead').filter((p) => !p.closest('.hero')).forEach((p) => unit(p, () => {
    const step = tms('--m-lead-step');
    rise(p, { dur: tms('--m-lead'), step, delay: slot(textKey(p), step * 2) });
  }, () => show(p)));

  // step cards: each card floats up from below, one rung after the last (user: "vsplyvat snizu stupenkoj"),
  // and its numeral and title lines rise inside it as it lands
  // step cards are animated by the anime.js layer in index.html (spring float, staircase)

  // what we buy: the five segments rise onto their rules
  $$('.buy-list li').forEach((li) => unit(li, () => row(li, slot(textKey(li), tms('--m-row-step'))), () => show(li)));

  // pictures
  const fig = $('.buy-fig');
  unit(fig, () => $$('img', fig).forEach((img) => curtain(img, slot(imgKey(fig), tms('--m-curtain-step')))), () => show(...$$('img', fig)));
  $$('.why-fig img').forEach((img) => unit(img, () => curtain(img, slot(imgKey(img), 0)), () => show(img)));
  $$('.final-img img').forEach((img) => unit(img, () => lightUp(img, slot(imgKey(img), 0)), () => show(img)));
  const rail = $('.rail');
  unit(rail, () => {
    const cars = $$('.car img', rail);
    const per = Math.max(1, parseInt(getComputedStyle(rail).getPropertyValue('--per'), 10) || 4);
    const base = slot(imgKey(rail), 0);
    // every page lifts in the same order, so a page turn finds its cars already in place
    cars.forEach((img, i) => curtain(img, base + (i % per) * tms('--m-curtain-step')));
  }, () => show(...$$('.car img', rail)));

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const u = units.get(e.target);
      if (!u) continue;
      if (e.isIntersecting) { io.unobserve(e.target); u.play(); }
      else if (e.boundingClientRect.bottom < 0) { io.unobserve(e.target); u.settle(); } // already passed: no replay behind the reader
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  units.forEach((_, el) => io.observe(el));

  /* ---- hero: plays once on load, inside the budget; the form never moves ---- */
  const heroGo = () => {}; // hero is animated by the anime.js layer in index.html (per-character spring cascade)
  // lines are measured, so wait for the display face, but never longer than 400ms
  Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), wait(400)]).then(heroGo);

  /* ---- scroll-driven fallback (no animation-timeline): one rAF, writes --p ---- */
  let offScroll = () => {};
  if (!(window.CSS && CSS.supports('animation-timeline: view()'))) {
    root.classList.add('m-sfb');
    const settle = bezier(tok('--m-ease-settle'));
    const pulls = $$('.step, .rail').map((el) => ({ el, pull: 0, ty: 0 }));
    const hero = $('.hero'), heroImg = $('.hero-img img');
    const measure = () => pulls.forEach((p) => { p.pull = parseFloat(getComputedStyle(p.el).getPropertyValue('--pull')) || 0; });
    let queued = false;
    const frame = () => {
      queued = false;
      const vh = innerHeight;
      for (const p of pulls) {
        const r = p.el.getBoundingClientRect();
        const top = r.top - p.ty; // undo our own translate before measuring
        const cover = (vh - top) / (vh + r.height);
        const k = settle(Math.min(1, Math.max(0, cover / 0.42)));
        p.ty = (1 - k) * p.pull;
        p.el.style.setProperty('--p', k.toFixed(4));
      }
      heroImg.style.setProperty('--p', Math.min(1, Math.max(0, scrollY / hero.offsetHeight)).toFixed(4));
    };
    const req = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };
    const onResize = () => { measure(); req(); };
    measure(); frame();
    addEventListener('scroll', req, { passive: true });
    addEventListener('resize', onResize);
    offScroll = () => {
      removeEventListener('scroll', req);
      removeEventListener('resize', onResize);
      [...pulls.map((p) => p.el), heroImg].forEach((el) => el.style.removeProperty('--p'));
    };
  }

  /* ---- reduced motion switched on mid-visit: everything goes to its still, final state ---- */
  rm.addEventListener('change', () => {
    if (!rm.matches) return;
    io.disconnect();
    [...live].forEach((end) => end());
    units.forEach((u) => u.settle());
    show($('.hero h1'), $('.hero .lead'));
    offScroll();
    root.classList.remove('js-motion', 'm-sfb');
  });

  root.classList.add('m-ready');
  } catch (err) {
    root.classList.remove('js-motion', 'm-sfb');
    console.error('motion layer disabled:', err);
  }
})();
