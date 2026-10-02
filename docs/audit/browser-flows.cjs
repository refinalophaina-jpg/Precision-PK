'use strict';
// ════════════════════════════════════════════════════════════════════════
// BROWSER FLOWS — real clicks and keystrokes, under the production CSP.
//
// Every programmatic "fix" of a UI defect in this file's history passed its own
// check and failed at the bedside (CLAUDE.md, UI work). This drives the app the
// way a pharmacist does — typed digits, clicked buttons, a phone viewport — and
// fails on any console error. Fictional patient only; dates are relative to
// today so the course always ends just before "now".
//
//   python3 docs/audit/serve-csp.py &            # the app under the real CSP
//   PLAYWRIGHT=/path/to/node_modules/playwright node docs/audit/browser-flows.cjs
//
// Playwright is not a dependency of this repository (no install is required to
// run the suites); point PLAYWRIGHT at any installed copy with its browsers.
// BASE overrides the URL; OUT the screenshot directory (default: a temp dir).
// ════════════════════════════════════════════════════════════════════════
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const BASE = process.env.BASE || 'http://localhost:8777/index.html';
const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'vanco-flows-'));
fs.mkdirSync(OUT, { recursive: true });
const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });

async function typeInto(page, sel, text) {
  const el = page.locator(sel);
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await el.fill('');
  await el.pressSequentially(String(text));
}
async function canvasInk(page, sel) {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel);
    if (!c || !c.width || !c.height) return { w: 0, h: 0, painted: 0, dark: 0 };
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let painted = 0, dark = 0;
    for (let i = 0; i < d.length; i += 16) {          // every 4th pixel
      if (d[i + 3] > 0) { painted++; if (d[i] + d[i + 1] + d[i + 2] < 60 && d[i + 3] > 200) dark++; }
    }
    return { w: c.width, h: c.height, painted, dark, total: d.length / 16 };
  }, sel);
}
function watch(page, tag) {
  const problems = [];
  // Two messages are not the app's: this script's own getImageData readback hint,
  // and, on production, the CSP refusing scripts Cloudflare injects into the page
  // (Web Analytics beacon, challenge platform). Those are the policy working.
  const notOurs = /willReadFrequently|cloudflareinsights|cdn-cgi\/challenge-platform|cdn-cgi\/rum/;
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !notOurs.test(m.text())) problems.push(`${tag} console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`${tag} pageerror: ${e.message}`));
  return problems;
}
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n);
  const p = (v) => String(v).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const D1 = day(-2), D2 = day(-1);   // doses at D1 08:00, D1 20:00, D2 08:00, D2 20:00; the level at D2 19:30
// On the production domain Cloudflare injects an inline bot-check script
// (window.__CF$cv$params) that the hash-pinned CSP refuses — the policy working,
// not the app failing. A refused inline script is attributed to it only when the
// page actually carries that script, and only as many refusals as it has copies;
// anything beyond that stays a problem. (The app's own script is hash-allowed:
// if it were refused, nothing on the page would work and the checks would fail.)
async function attributeInjected(page, problems) {
  const n = await page.evaluate(() => [...document.scripts].filter(s => !s.src && /__CF\$cv\$params/.test(s.textContent)).length);
  if (!n) return { kept: problems, injected: 0 };
  const inline = /Executing inline script violates|Refused to execute inline script|CSP violation: script-src(-elem)? inline/;
  let budget = { browser: n, listener: n };
  const kept = problems.filter(p => {
    if (!inline.test(p)) return true;
    const k = /CSP violation:/.test(p) ? 'listener' : 'browser';
    if (budget[k] > 0) { budget[k]--; return false; }
    return true;
  });
  return { kept, injected: n };
}
async function enterCourse(page) {
  // Dose 1 set by hand; doses 2-4 must continue the course on their own.
  await page.locator('[data-onclick="k43"]').click();
  await typeInto(page, '#b-dose-mg-1', '1000');
  await page.locator('#b-dose-date-1').fill(D1);
  await typeInto(page, '#b-dose-time-1', '08:00');
  for (let i = 0; i < 3; i++) await page.locator('[data-onclick="k43"]').click();
  const rows = await page.evaluate(() => [1, 2, 3, 4].map(n => ({
    mg: document.getElementById(`b-dose-mg-${n}`)?.value, tinf: document.getElementById(`b-dose-tinf-${n}`)?.value,
    date: document.getElementById(`b-dose-date-${n}`)?.value, time: document.getElementById(`b-dose-time-${n}`)?.value,
    rb: document.getElementById(`course-rb-dose-${n}`)?.textContent.trim() })));
  await page.locator('[data-onclick="k46"]').click();
  await typeInto(page, '#b-lvl-conc-1', '15.2');
  await page.locator('#b-lvl-date-1').fill(D2);
  await typeInto(page, '#b-lvl-time-1', '19:30');
  await page.waitForTimeout(300);
  const lvlRb = await page.locator('#course-rb-level-1').textContent();
  return { rows, lvlRb: (lvlRb || '').trim() };
}

(async () => {
  const browser = await chromium.launch();
  const results = { problems: [] };

  // ───────────── desktop 1440×900 ─────────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  results.problems.push(...[]);
  const dProblems = watch(page, 'desktop');
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation',
    e => console.error('CSP violation: ' + e.violatedDirective + ' ' + e.blockedURI)));
  await page.goto(BASE + '?v=pw-' + Date.now(), { waitUntil: 'networkidle' });

  ok('print action hidden before any result', !(await page.locator('.print-fab').isVisible()));

  // Trough: refused without sex, then a real result.
  await typeInto(page, '#age', '60'); await typeInto(page, '#tbw', '80');
  await typeInto(page, '#height', '175'); await typeInto(page, '#scr', '1.0');
  await page.locator('[data-onclick="k31"]').click();
  const fe = await page.locator('#fe-trough').textContent().catch(() => '');
  ok('Trough refuses without sex, inline', /Choose the patient.s sex/.test(fe || ''), fe);
  ok('focus moves to the error summary', await page.evaluate(() => document.activeElement?.id) === 'fe-trough');
  await page.locator('[data-onclick="k9"]').first().click();
  await page.locator('[data-onclick="k31"]').click();
  await page.waitForTimeout(400);
  const tText = (await page.locator('#results-content').innerText()).replace(/\s+/g, ' ');
  ok('Trough result renders a regimen', /\d(\.\d+)? ?g IV q\d+h|\d+ mg IV q\d+h/.test(tText), tText.slice(0, 160));
  ok('Trough error summary cleared', !(await page.locator('#fe-trough').isVisible()) || !(await page.locator('#fe-trough').innerText()).trim());
  ok('print action shown with a result', await page.locator('.print-fab').isVisible());
  ok('disclaimer on screen under the Trough result', await page.locator('#panel-right .rp-disclaimer').isVisible());
  const tCaps = await page.evaluate(() => {
    const ds = [...document.querySelectorAll('#results-content details')]; const was = ds.map(d => d.open);
    ds.forEach(d => { d.open = true; });
    const hits = [...document.querySelectorAll('body *')].filter(e => e.offsetParent && getComputedStyle(e).textTransform === 'uppercase'
      && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
      .map(e => (e.id || e.tagName) + '.' + String(e.className).slice(0, 30) + ' "' + e.textContent.trim().slice(0, 24) + '"');
    ds.forEach((d, i) => { d.open = was[i]; });
    return hits;
  });
  ok('Trough evidence: no text set in CSS capitals', !tCaps.length, tCaps.join(' | '));
  // Scrolled so the result's foot — the evidence and the disclaimer under it — is on screen.
  await page.evaluate(() => document.querySelector('#panel-right .rp-disclaimer').scrollIntoView({ block: 'end', behavior: 'instant' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'desktop-trough.png') });

  // Stale marker on edit, cleared on revert.
  await typeInto(page, '#age', '61'); await page.waitForTimeout(250);
  ok('Trough result marked stale after an edit', await page.locator('#results-content .stale-line, .stale-line').first().isVisible().catch(() => false));
  await typeInto(page, '#age', '60'); await page.waitForTimeout(250);
  ok('stale marker clears when the edit is reverted', !(await page.locator('.stale-line:visible').count()));

  // AUC Precision: demographics carried, course entry, run.
  await page.locator('[data-onclick="k2"]').click();
  const carried = await page.evaluate(() => ({
    age: document.getElementById('b-age').value, tbw: document.getElementById('b-tbw').value,
    ht: document.getElementById('b-height').value, scr: document.getElementById('b-scr').value,
    male: document.querySelector('[data-onclick="k39"]').getAttribute('aria-pressed') }));
  ok('demographics carried into AUC Precision', carried.age === '60' && carried.tbw === '80' && carried.ht === '175' && carried.male === 'true', JSON.stringify(carried));
  if (!carried.scr) { await typeInto(page, '#b-scr', '1.0'); }
  ok('print action hidden on a module with no result', !(await page.locator('.print-fab').isVisible()));

  const course = await enterCourse(page);
  results.course = course;
  const r = course.rows;
  ok('doses 2-4 continue the course (mg, date, time)',
     r[1].mg === '1000' && r[1].date === D1 && r[1].time === '20:00' &&
     r[2].date === D2 && r[2].time === '08:00' && r[3].date === D2 && r[3].time === '20:00', JSON.stringify(r));
  ok('dose read-back names the gap', /12 h after dose/.test(r[2].rb || ''), r[2].rb);
  ok('level read-back names its dose', /after dose 3/.test(course.lvlRb), course.lvlRb);

  await page.locator('[data-onclick="k47"]').click();
  try { await page.waitForSelector('#b-results .rec-dose', { timeout: 20000 }); }
  catch (e) {
    const dump = await page.evaluate(() => ({
      errors: [...document.querySelectorAll('.form-errors, .form-backstop, [role=alert]')].filter(x => x.offsetParent).map(x => x.id + ': ' + x.textContent.replace(/\s+/g, ' ').trim()),
      results: (document.getElementById('b-results')?.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
      resDisplay: document.getElementById('b-results')?.style.display,
      rows: [1,2,3,4].map(n => ['mg','tinf','date','time'].map(f => document.getElementById(`b-dose-${f}-${n}`)?.value).join('|')),
      lvl: ['conc','date','time'].map(f => document.getElementById(`b-lvl-${f}-1`)?.value).join('|') }));
    console.log('DUMP', JSON.stringify(dump, null, 1)); console.log('PROBLEMS', dProblems); throw e;
  }
  await page.waitForTimeout(500);
  const v = await page.evaluate(() => {
    const t = (s) => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() || '';
    return { dose: t('#b-results .rec-dose'), prov: !!document.querySelector('#b-results .vx-prov'), conf: t('#b-results .vx-conf'), next: t('#b-results .vx-next'),
      summary: t('#b-summary'), strip: document.querySelectorAll('#b-course-strip *').length,
      announce: t('#sr-announce'), evs: [...document.querySelectorAll('#b-results details.ev > summary')].map(s => s.textContent.replace(/\s+/g, ' ').trim()) };
  });
  results.verdict = v;
  ok('AUC verdict headline is an ISMP dose', /^\d+(\.\d+)? g$|^\d{3} mg$/.test(v.dose), v.dose);
  ok('confidence and next step present', v.conf && v.next, v.conf + ' | ' + v.next);
  ok('course strip drawn', v.strip > 5, v.strip);
  ok('result announced to screen readers', /Result|dose|AUC/i.test(v.announce), v.announce);
  const ink0 = await canvasInk(page, '#b-profile-canvas');
  ok('profile canvas drawn', ink0.painted > 500, JSON.stringify(ink0));
  ok('print action shown after the AUC result', await page.locator('.print-fab').isVisible());
  // The design review's fixes (2026-09-29), each as behaviour.
  const look = await page.evaluate(() => {
    const cs = (el) => el && getComputedStyle(el);
    const disc = [...document.querySelectorAll('.rp-disclaimer')].filter(e => e.offsetParent);
    const cards = [...document.querySelectorAll('.model-grid .model-opt')];
    const on = cards.find(b => b.classList.contains('active')), off = cards.find(b => !b.classList.contains('active'));
    const lv = document.querySelector('#b-course-strip .lv');
    return {
      disclaimer: disc.map(e => e.textContent.trim()),
      future: !!document.querySelector('#b-course-strip rect.future'),
      stripNow: !!document.querySelector('#b-course-strip .nowl'),
      levelFill: lv && cs(lv).fill, ink: cs(document.body).color,
      measured: (() => { const i = document.createElement('i'); i.style.color = 'var(--series-measured)'; document.body.append(i); const c = cs(i).color; i.remove(); return c; })(),
      confColour: cs(document.querySelector('#b-results .vx-conf .conf-level'))?.color,
      provColour: cs(document.querySelector('#b-results .vx-prov'))?.color,
      saveColour: cs(document.querySelector('.profile-save-btn'))?.color,
      saveBorder: cs(document.querySelector('.profile-save-btn'))?.borderTopColor,
      cardBorders: [cs(on)?.borderTopColor, cs(off)?.borderTopColor],
      noteBox: cs(document.querySelector('.profile-privacy-note'))?.borderLeftWidth,
    };
  });
  results.look = look;
  ok('disclaimer on screen under the AUC result', look.disclaimer.some(t => /not clinically validated/.test(t)), JSON.stringify(look.disclaimer));
  ok('the course strip marks after-now as prediction', look.future);
  ok('beside the verdict the strip leaves "now" to the curve', !look.stripNow);
  // Profile polish (2026-10-02, the user's request): measured levels moved from ink to their own
  // hue, --series-measured (was: "measured levels are ink, not rose").
  ok('measured levels wear their own hue, not ink', look.levelFill === look.measured && look.levelFill !== look.ink, look.levelFill + ' vs ' + look.measured + ' / ink ' + look.ink);
  // Model and measurement in different colours (D14): the key's fit swatch, its band and
  // its ring share one hue; the measured-level swatch is ink; the two never coincide.
  const key = await page.evaluate(() => { const g = (sel, prop) => { const e = document.querySelector('#b-results ' + sel); return e && getComputedStyle(e)[prop]; };
    return { fit: g('.lg-ind', 'borderTopColor'), ring: g('.lg-ring', 'borderTopColor'), data: g('.lg-lv', 'backgroundColor'), prior: g('.lg-pop', 'borderTopColor') }; });
  ok('the key separates model from measurement', key.fit && key.fit === key.ring && key.fit !== key.data && key.prior !== key.fit && key.prior !== key.data, JSON.stringify(key));
  ok('the de-rated state is one hue ("provisional" and the confidence word)', look.confColour === look.provColour, look.confColour + ' / ' + look.provColour);
  ok('the save action is ink, not purple', look.saveColour === look.ink, look.saveColour);
  ok('model selection is not a border', look.cardBorders[0] === look.cardBorders[1], JSON.stringify(look.cardBorders));
  ok('the privacy note is not a box inside the profiles box', look.noteBox === '0px', look.noteBox);
  // The Dose Tinkerer in the profile chart's colour code (D14): trying a regimen other
  // than the current one draws it beside the current regimen and the population
  // estimate; the comparison leads with the current regimen. Run before the capitals
  // check so the Tinkerer's result is covered by it too.
  await page.evaluate(() => { const d = document.getElementById('ev-explore'); if (d) d.open = true; });
  await typeInto(page, '#b-tink-dose', '1250');
  await page.locator('#b-tink-int').selectOption('12');
  await page.locator('[data-onclick="k66"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-onclick="k68"]').click();
  await page.waitForTimeout(400);
  const tink = await page.evaluate(() => ({
    key: [...document.querySelectorAll('#b-tink-result .tink-legend .legend-item')].map(e => e.textContent.trim()),
    cmp: [...document.querySelectorAll('#b-compare-section .compare-legend-item')].map(e => e.textContent.trim()) }));
  ok('Tinkerer key: trying, current, population estimate, trough reference',
     /^Trying /.test(tink.key[0] || '') && tink.key.some(t => /^Current /.test(t)) && tink.key.includes('Population estimate') && tink.key.some(t => /^Trough reference/.test(t)), JSON.stringify(tink.key));
  ok('comparison leads with the current regimen, then the tried one', /^Current /.test(tink.cmp[0] || '') && /^1\.25 g IV q12h/.test(tink.cmp[1] || ''), JSON.stringify(tink.cmp));

  // House style: no eyebrows — nothing on screen is set in CSS capitals. Every
  // evidence section is opened for the check and restored after it.
  const caps = await page.evaluate(() => {
    const ds = [...document.querySelectorAll('#b-results details')]; const was = ds.map(d => d.open);
    ds.forEach(d => { d.open = true; });
    const hits = [...document.querySelectorAll('body *')].filter(e => e.offsetParent && getComputedStyle(e).textTransform === 'uppercase'
      && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
      .map(e => (e.id || e.tagName) + '.' + String(e.className).slice(0, 30) + ' "' + e.textContent.trim().slice(0, 24) + '"');
    ds.forEach((d, i) => { d.open = was[i]; });
    return hits;
  });
  ok('no text on screen is set in CSS capitals (no eyebrows)', !caps.length, caps.join(' | '));

  await page.locator('#b-results .vx-top, #b-results').first().scrollIntoViewIfNeeded();
  await page.evaluate(() => { const el = document.querySelector('#b-results .vx-top') || document.getElementById('b-results'); window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 72, behavior: 'instant' }); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, 'desktop.png') });
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })); await page.waitForTimeout(250);   // full page from the document top
  await page.screenshot({ path: path.join(OUT, 'desktop-full.png'), fullPage: true });

  // Theme and resize must not wipe or blacken the canvases.
  await page.locator('.theme-toggle').click();
  await page.waitForTimeout(400);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  const ink1 = await canvasInk(page, '#b-profile-canvas');
  ok('dark theme applied', theme === 'dark', theme);
  ok('canvas survives the theme toggle (not blank, not black)', ink1.painted > 500 && ink1.dark < ink1.total * 0.5, JSON.stringify(ink1));
  await page.evaluate(() => { const el = document.querySelector('#b-results .vx-top') || document.getElementById('b-results'); window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 72, behavior: 'instant' }); });
  await page.screenshot({ path: path.join(OUT, 'desktop-dark.png') });
  await page.setViewportSize({ width: 1100, height: 900 }); await page.waitForTimeout(400);
  const ink2 = await canvasInk(page, '#b-profile-canvas');
  ok('canvas survives a resize', ink2.painted > 500, JSON.stringify(ink2));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
  await page.locator('.theme-toggle').click(); await page.waitForTimeout(300);

  // The shared time cursor: the strip drives the curve, the curve drives the strip.
  const sig = () => page.evaluate(() => { const c = document.getElementById('b-profile-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0;
    for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) >>> 0; return h; });
  await page.evaluate(() => { const el = document.querySelector('#b-results .vx-top'); window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 72, behavior: 'instant' }); });
  await page.waitForTimeout(150);
  const s0 = await sig();
  const sb = await page.locator('#b-course-strip').boundingBox();
  await page.mouse.move(sb.x + sb.width * 0.55, sb.y + sb.height / 2);
  await page.waitForTimeout(120);
  const s1 = await sig();
  const stripVis = await page.evaluate(() => document.querySelector('#b-course-strip line.cursor')?.getAttribute('visibility'));
  ok('pointing at the strip draws the cursor on the curve', stripVis === 'visible' && s1 !== s0, `${stripVis} ${s0} ${s1}`);
  await page.screenshot({ path: path.join(OUT, 'desktop-cursor.png') });
  const cb = await page.locator('#b-profile-canvas').boundingBox();
  await page.mouse.move(cb.x + cb.width * 0.4, cb.y + cb.height / 2);
  await page.waitForTimeout(120);
  const rule = await page.evaluate(() => { const el = document.getElementById('b-course-strip'); const ln = el.querySelector('line.cursor');
    const r = el.getBoundingClientRect(); return { vis: ln.getAttribute('visibility'), x: +ln.getAttribute('x1') * r.width / el._stripAxis.W + r.left }; });
  ok('pointing at the curve moves the strip rule to the same x', rule.vis === 'visible' && Math.abs(rule.x - (cb.x + cb.width * 0.4)) < 2, JSON.stringify(rule) + ' vs ' + (cb.x + cb.width * 0.4).toFixed(1));
  await page.mouse.move(4, 4); await page.waitForTimeout(80);
  ok('leaving clears both', (await page.evaluate(() => document.querySelector('#b-course-strip line.cursor')?.getAttribute('visibility'))) === 'hidden' && (await sig()) === s0);

  // AUC stale marker (before the profile load, which clears the result).
  await typeInto(page, '#b-scr', '1.3'); await page.waitForTimeout(300);
  ok('AUC result marked stale after an edit', await page.locator('#b-results .stale-line, .panel-right .stale-line').first().isVisible().catch(() => false));

  // A saved profile restores its model card (the highlight used to stay put).
  const cards = () => page.evaluate(() => [...document.querySelectorAll('.model-grid .model-opt')]
    .map(b => b.id.replace('b-model-btn-', '') + ':' + b.classList.contains('active') + '/' + b.getAttribute('aria-pressed')).join(','));
  await page.locator('#b-model-btn-goti').click();
  await typeInto(page, '#profile-label-input', 'Test A');
  await page.locator('[data-onclick="k37"]:visible').click();
  await page.waitForTimeout(200);
  await page.locator('#b-model-btn-buelga').click();
  await page.locator('.profile-item-btn.load:visible').first().click();
  await page.waitForTimeout(300);
  const afterLoad = await cards();
  ok('loading a profile moves the model highlight', afterLoad === 'buelga:false/false,goti:true/true,hughes:false/false,gotihd:false/false', afterLoad);


  // Reset: sex unchosen in both modules, Buelga card lit.
  await page.locator('[data-onclick="k48"]').click();
  await page.waitForTimeout(250);
  const sexLit = await page.evaluate(() => [...document.querySelectorAll('[data-onclick="k9"],[data-onclick="k10"],[data-onclick="k39"],[data-onclick="k40"]')]
    .map(b => b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true'));
  ok('Reset leaves sex unchosen in both modules', sexLit.every(x => !x), JSON.stringify(sexLit));
  const afterReset = await cards();
  ok('Reset returns the model card to Buelga', afterReset === 'buelga:true/true,goti:false/false,hughes:false/false,gotihd:false/false', afterReset);

  // Trough chart, steady-state trough with a measured level: the profile chart's colour code
  // (D14) — the fitted current regimen, the recommendation, the population estimate as the
  // grey dash, and the level. The key names each.
  await page.locator('[data-onclick="k1"]').click();
  await page.locator('[data-onclick="k9"]').first().click();
  await page.locator('#mode-btn-level').click();
  await typeInto(page, '#dose', '1000');
  await page.locator('#interval').selectOption('12');
  await page.evaluate(() => { const h = document.getElementById('has-level'); if (h && !h.checked) h.click(); });
  await typeInto(page, '#level-val', '24');
  await page.locator('#time-dose-given').fill(`${D2}T08:00`);
  await page.locator('#time-level-drawn').fill(`${D2}T19:30`);
  await page.locator('[data-onclick="k31"]').click();
  await page.waitForTimeout(600);
  const ssKey = await page.evaluate(() => [...document.querySelectorAll('#results-content .tx-legend .legend-item')].map(e => e.textContent.trim()));
  ok('Trough steady-state key: fit, recommendation, population estimate, level',
     ssKey.some(t => /^Current /.test(t)) && ssKey.some(t => /^Recommended /.test(t)) && ssKey.includes('Population estimate') && ssKey.includes('Measured level'), JSON.stringify(ssKey));
  // "Try another regimen" on the same result: its own comparison in the Tinkerer's code —
  // the tried regimen beside the fitted current regimen and the population estimate —
  // while the result's chart and its key stay as they were (D14).
  await page.evaluate(() => { const d = document.getElementById('tx-ev-tinker'); if (d) d.open = true; });
  await typeInto(page, '#tinker-dose-ss', '1250');
  await page.locator('#tinker-tau-ss').selectOption('8');
  await page.locator('[data-onclick="k59"][data-arg="ss"]').click();
  await page.waitForTimeout(400);
  const txTink = await page.evaluate(() => ({
    key: [...document.querySelectorAll('#tinker-result-ss .tink-legend .legend-item')].map(e => e.textContent.trim()),
    main: [...document.querySelectorAll('#results-content .tx-legend .legend-item')].map(e => e.textContent.trim()) }));
  ok('Trough "Try another regimen" key: trying, current, population estimate, trough target',
     /^Trying 1\.25 g IV q8h/.test(txTink.key[0] || '') && txTink.key.some(t => /^Current 1 g IV q12h/.test(t)) && txTink.key.includes('Population estimate') && txTink.key.some(t => /^Trough target/.test(t)), JSON.stringify(txTink.key));
  ok('trying a regimen leaves the Trough chart and its key as they were', JSON.stringify(txTink.main) === JSON.stringify(ssKey), JSON.stringify(txTink.main));
  const txInk = await canvasInk(page, '#tx-tink-canvas-ss');
  ok('the Trough comparison is drawn', txInk.w > 0 && txInk.painted > 0, JSON.stringify(txInk));
  await page.evaluate(() => { const el = document.getElementById('tinker-result-ss'); window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 80, behavior: 'instant' }); });
  await page.waitForTimeout(200);
  await page.locator('#tinker-result-ss').screenshot({ path: path.join(OUT, 'desktop-trough-tinker.png') });
  // The dose explorer marks the rows the chart draws with the chart key's line and word (D14):
  // the current regimen on the fit's line, the recommendation on the projection's.
  const xRows = await page.evaluate(() => [...document.querySelectorAll('#tx-ev-explorer tbody tr[class]')].map(r => ({
    cls: r.className, key: (r.querySelector('.tx-row-tag .lg') || {}).className || '',
    text: r.querySelector('th').textContent.replace(/\s+/g, ' ').trim() })));
  ok('dose explorer keys the chart\'s regimens: current on the fit\'s line, recommended on the projection\'s',
     xRows.length === 2 && xRows.some(r => r.cls === 'is-cur' && /lg-ind/.test(r.key) && r.text === '1 g q12h current') &&
     xRows.some(r => r.cls === 'is-rec' && /lg-proj/.test(r.key) && / recommended$/.test(r.text)), JSON.stringify(xRows));
  const dAttr = await attributeInjected(page, dProblems);
  results.cloudflareInjected = dAttr.injected;
  results.problems.push(...dAttr.kept);
  await ctx.close();

  // ───────────── phone 375×812 ─────────────
  const mctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  const mProblems = watch(m, 'mobile');
  await m.goto(BASE + '?v=pwm-' + Date.now(), { waitUntil: 'networkidle' });
  const hdr = await m.evaluate(() => ({ h: Math.round(document.querySelector('header.header').getBoundingClientRect().height), sw: document.documentElement.scrollWidth, iw: innerWidth }));
  ok('phone header is one row (≤60px)', hdr.h <= 60, JSON.stringify(hdr));
  ok('no horizontal scroll at 375 (top)', hdr.sw <= hdr.iw, JSON.stringify(hdr));
  const tabs = await m.evaluate(() => [...document.querySelectorAll('.calc-mode-bar .calc-mode-btn')].map(b => ({ t: b.textContent.trim(),
    lines: (() => { const r = document.createRange(); r.selectNodeContents(b); const rs = [...r.getClientRects()]; return new Set(rs.map(x => Math.round(x.top))).size; })(), clipped: b.scrollWidth > b.clientWidth + 1 })));
  ok('mode tabs at 375: sentence case, one line each, none clipped', tabs.every(t => t.t !== t.t.toUpperCase() && !t.clipped && t.lines <= 1), JSON.stringify(tabs));
  await m.screenshot({ path: path.join(OUT, 'mobile-top.png') });
  await m.locator('[data-onclick="k2"]').tap();
  await typeInto(m, '#b-age', '60'); await typeInto(m, '#b-tbw', '80'); await typeInto(m, '#b-height', '175'); await typeInto(m, '#b-scr', '1.0');
  await m.locator('[data-onclick="k39"]').tap();
  await enterCourse(m);
  const rowsFit = await m.evaluate(() => [...document.querySelectorAll('#b-dose-tbody tr, #b-level-tbody tr')].every(tr => tr.getBoundingClientRect().right <= innerWidth + 0.5) && document.documentElement.scrollWidth <= innerWidth);
  ok('course rows reflow inside 375', rowsFit);
  await m.locator('#b-dose-tbody').scrollIntoViewIfNeeded();
  await m.screenshot({ path: path.join(OUT, 'mobile-course.png') });
  await m.locator('[data-onclick="k47"]').tap();
  await m.waitForSelector('#b-results .rec-dose', { timeout: 20000 });
  await m.waitForTimeout(600);
  const mOver = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth,
    wide: [...document.querySelectorAll('.panel-right *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 0.5 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 6).map(e => (e.id || e.tagName) + '.' + String(e.className).slice(0, 30)) }));
  ok('no horizontal scroll at 375 (results)', mOver.sw <= mOver.iw && !mOver.wide.length, JSON.stringify(mOver));
  const mStrip = await m.evaluate(() => ({ ticks: document.querySelectorAll('#b-course-strip .axl').length,
    now: !!document.querySelector('#b-course-strip .nowl') }));
  ok('on a phone the strip carries its own clock axis and names "now"', mStrip.ticks >= 2 && mStrip.now, JSON.stringify(mStrip));
  await m.evaluate(() => { const el = document.querySelector('#b-results .vx-top') || document.getElementById('b-results'); window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 64, behavior: 'instant' }); });
  await m.waitForTimeout(250);
  await m.screenshot({ path: path.join(OUT, 'mobile.png') });
  await m.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })); await m.waitForTimeout(250);   // full page from the document top
  await m.screenshot({ path: path.join(OUT, 'mobile-full.png'), fullPage: true });
  // Haemodialysis sessions (D15), typed on the phone: Goti-HD shows the session rows; a
  // level reads against the session; the result labels it, reads the pre-HD level at the
  // planned session with its assumption, and bands both sessions on the strip.
  await m.locator('#b-model-btn-gotihd').tap();
  const hdShown = await m.locator('#b-hd-wrap').isVisible();
  await m.locator('[data-onclick="k74"]').tap();
  await m.locator('#b-hd-date-1').fill(D2); await typeInto(m, '#b-hd-time-1', '13:00'); await typeInto(m, '#b-hd-hours-1', '4');
  await m.locator('[data-onclick="k74"]').tap();
  await m.locator('#b-hd-date-2').fill(day(1)); await typeInto(m, '#b-hd-time-2', '13:00'); await typeInto(m, '#b-hd-hours-2', '4');
  await m.waitForTimeout(250);
  const hdRb = await m.evaluate(() => [...document.querySelectorAll('[id^="course-rb-level-"]')].map(e => e.textContent));
  await m.locator('[data-onclick="k47"]').tap();
  await m.waitForSelector('#b-results .vx-hd', { timeout: 20000 });
  await m.waitForTimeout(500);
  const hdRes = await m.evaluate(() => ({ pre: document.querySelector('#b-results .vx-hd').textContent.replace(/\s+/g, ' ').trim(),
    bands: document.querySelectorAll('#b-course-strip rect.hd').length, section: !!document.getElementById('ev-hd'),
    sw: document.documentElement.scrollWidth, iw: innerWidth }));
  ok('HD sessions: shown for Goti-HD; a level reads against the session as typed', hdShown && hdRb.some(t => /after HD session 1 ended/.test(t)), JSON.stringify(hdRb));
  ok('HD sessions: pre-HD read at the planned session, assumption stated; both sessions banded; no overflow',
     /Pre-HD Session 2, .*fitted [\d.]+ mg\/L if no further dose is given/.test(hdRes.pre) && hdRes.bands === 2 && hdRes.section && hdRes.sw <= hdRes.iw, JSON.stringify(hdRes));
  await m.evaluate(() => { const el = document.querySelector('#b-results .vx-top'); window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 64, behavior: 'instant' }); });
  await m.waitForTimeout(250);
  await m.screenshot({ path: path.join(OUT, 'mobile-hd.png') });
  // D16: generate an MWF schedule; with a level the verdict is a post-HD dose (or a hold, or a
  // request for sessions), never a q-interval regimen; the Trough guard refuses an HD patient.
  await m.evaluate(() => { const d = document.querySelector('.hd-sched'); if (d) d.open = true; });
  await m.locator('#b-hds-pattern').selectOption('MWF');
  await m.locator('#b-hds-date').fill(day(2)); await typeInto(m, '#b-hds-time', '13:00');
  await typeInto(m, '#b-hds-hours', '4'); await typeInto(m, '#b-hds-count', '3');
  await m.locator('[data-onclick="k76"]').tap();
  const nSess = await m.evaluate(() => document.querySelectorAll('[id^="b-hd-row-"]').length);
  await m.locator('[data-onclick="k47"]').tap();
  await m.waitForSelector('#b-results #vx-regimen', { timeout: 20000 }); await m.waitForTimeout(400);
  const hdVerdict = await m.evaluate(() => document.getElementById('vx-regimen').textContent.replace(/\s+/g, ' ').trim());
  ok('HD schedule adds 3 sessions; the verdict is a post-HD dose, a hold, or asks for sessions — never q-interval',
     nSess === 5 && /IV after HD|No dose after session|Planned:/.test(hdVerdict) && !/\bq\d+h\b/.test(hdVerdict), `${nSess} · ${hdVerdict}`);
  await m.evaluate(() => { const el = document.querySelector('#b-results .vx-top'); window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 64, behavior: 'instant' }); });
  await m.waitForTimeout(250);
  await m.screenshot({ path: path.join(OUT, 'mobile-hd-dose.png') });
  // No level yet: the empiric table (Rybak 2020 Rec 13), acknowledging the doses already given, inside 375 px.
  await m.locator('[data-onclick="k62"][data-arg="1"]').tap();
  await m.locator('[data-onclick="k47"]').tap();
  await m.waitForFunction(() => /Empiric haemodialysis dosing/.test((document.getElementById('vx-regimen') || {}).textContent || ''), null, { timeout: 20000 });
  const emp = await m.evaluate(() => { const t = document.querySelector('.vx-hd-empiric'); const r = t.getBoundingClientRect();
    return { visible: !!t.offsetParent, right: r.right, iw: innerWidth, sw: document.documentElement.scrollWidth,
      given: /already entered/.test(document.querySelector('.vx-verdict').textContent) }; });
  ok('Goti-HD with no level shows the empiric table, says doses were given, and fits 375 px',
     emp.visible && emp.given && emp.sw <= emp.iw, JSON.stringify(emp));
  await m.locator('[data-onclick="k1"]').tap();
  await m.evaluate(() => { const c = document.getElementById('t-hd'); if (c && !c.checked) c.click(); });
  await m.locator('[data-onclick="k31"]').tap(); await m.waitForTimeout(300);
  const guard = await m.evaluate(() => { const rc = document.getElementById('results-content'); const n = rc && rc.querySelector('.note');
    const b = rc && rc.querySelector('[data-onclick="k77"]');
    return { text: (n && n.innerText) || '', visible: !!(n && n.offsetParent), button: !!(b && b.offsetParent) }; });
  ok('Trough module visibly refuses an HD patient and offers Goti-HD',
     guard.visible && guard.button && /use AUC Precision/.test(guard.text) && !/mg IV q\d+h/.test(guard.text), JSON.stringify(guard).slice(0, 200));
  const mAttr = await attributeInjected(m, mProblems);
  results.cloudflareInjected += mAttr.injected;
  results.problems.push(...mAttr.kept);
  await mctx.close();
  await browser.close();

  results.checks = checks;
  const failed = checks.filter(c => !c.pass);
  console.log(JSON.stringify(results, null, 1));
  const cf = results.cloudflareInjected ? `; ${results.cloudflareInjected} Cloudflare-injected inline script(s) refused by the CSP, as designed` : '';
  console.log(`\n${checks.length - failed.length}/${checks.length} checks pass; ${results.problems.length} console problem(s)${cf}; screenshots in ${OUT}`);
  process.exit(failed.length || results.problems.length ? 1 : 0);
})().catch(e => { console.error('RUN FAILED:', e); process.exit(2); });
