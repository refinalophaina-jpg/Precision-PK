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
// One sentence about a further level (D26): "would add little" never beside a sentence that asks for a
// level ("Draw a level." included, Task 9) or beside a Hold (final review C1); the cap-bound alarm never
// beside "a dose change is indicated" or "how large it needs to be" (Task 6b review); and a Hold never
// beside the severe-renal note's "Give a … loading dose" (final review I5).
const HOLD_RE = /Hold: |Hold the (?:\d+ )?planned dose/;
const incoherent = (s) => (/would add little/.test(s) && (/is recommended|Confirm the clearance with a level|another level may settle it|Draw a level|Recheck a level/.test(s) || HOLD_RE.test(s)))
  || (/cannot be reached within the conventional ceilings/.test(s) && /a dose change is indicated|how large it needs to be/.test(s))
  || (HOLD_RE.test(s) && /Give (?:a|one) [^.]*?loading dose/.test(s))
  // Wave 2 (N3): "No further dose until a level" never beside "Give … loading dose".
  || (/no further dose until a level/i.test(s) && /give (?:a|one) [^.]*?loading dose/i.test(s));

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

  // v3.13.0 (D24): Print is one of the answer's actions; there is no floating button.
  ok('print action hidden before any result', (await page.locator('[data-onclick="k0"]:visible').count()) === 0 && (await page.locator('.print-fab').count()) === 0);

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
  ok('print action shown with a result, in its actions', await page.locator('#results-content .vx-actions [data-onclick="k0"]').isVisible());
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

  {
    const paper = await page.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return ((document.getElementById('print-report') || {}).textContent || '').replace(/\s+/g, ' '); });
    ok('D26: print says not clinically validated (Trough result)', /not clinically validated/.test(paper) && /Clinician judgment required/.test(paper) && paper.length > 200, paper.slice(-300));
  }
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
  ok('print action hidden on a module with no result', (await page.locator('[data-onclick="k0"]:visible').count()) === 0);

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
  ok('print action shown after the AUC result, beside Copy summary', await page.locator('#b-results .vx-actions [data-onclick="k0"]').isVisible());
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
    const tok = (v) => { const i = document.createElement('i'); i.style.color = `var(${v})`; document.body.append(i); const c = getComputedStyle(i).color; i.remove(); return c; };
    // The prior's key is a 6/4 dash drawn as a gradient (a CSS dashed border cannot match the canvas).
    return { fit: g('.lg-ind', 'borderTopColor'), ring: g('.lg-ring', 'borderTopColor'), data: g('.lg-lv', 'backgroundColor'),
      prior: (g('.lg-pop', 'backgroundImage') || '').includes(tok('--ink-soft')) ? tok('--ink-soft') : 'missing' }; });
  ok('the key separates model from measurement', key.fit && key.fit === key.ring && key.fit !== key.data && key.prior !== key.fit && key.prior !== key.data, JSON.stringify(key));
  ok('the de-rated state is one hue ("provisional" and the confidence word)', look.confColour === look.provColour, look.confColour + ' / ' + look.provColour);
  // v3.11.0 (D22): the answer first. The verdict reads regimen, AUC, trough, then confidence
  // and Next, then the first dose on one line; AUC/MIC is not repeated at MIC 1; the chart's
  // summary is the canvas's label only. At 1280 × 800 confidence and Next are on the first screen.
  const answer = await page.evaluate(() => {
    const v = document.querySelector('#b-results .vx-verdict'), at = (s) => { const e = v.querySelector(s); return e ? e.getBoundingClientRect().top : -1; };
    const first = v.querySelector('.vx-first'), edit = document.getElementById('b-first-edit'), sum = document.getElementById('b-summary');
    return { order: ['#vx-regimen', '.vx-auc', '.vx-rec .vx-sub', '.vx-conf', '.vx-next', '.vx-first'].map(at),
      firstText: first ? first.textContent.replace(/\s+/g, ' ').trim() : '', firstParas: v.querySelectorAll('.vx-first').length,
      editHidden: !!edit && edit.hidden && !edit.offsetParent, aucMic: /AUC\/MIC/.test(v.textContent),
      summaryShown: !!sum && !!sum.offsetParent, summaryKept: !!sum && sum.textContent.length > 20,
      canvasLabel: /^Concentration–time curve\. /.test(document.getElementById('b-profile-canvas').getAttribute('aria-label') || '') };
  });
  ok('the answer reads regimen → AUC → trough → confidence → Next → first dose',
     answer.order.every(t => t >= 0) && answer.order.every((t, i, a) => i === 0 || t > a[i - 1]), JSON.stringify(answer.order));
  ok('the first dose is one sentence, time and level by then, with "change"; its date and time closed',
     answer.firstParas === 1 && /level by then [\d.]+ mg\/L · change$/.test(answer.firstText) && answer.editHidden, JSON.stringify(answer));
  ok('said once: no AUC/MIC at MIC 1; the chart summary is the canvas label, not a paragraph',
     !answer.aucMic && !answer.summaryShown && answer.summaryKept && answer.canvasLabel, JSON.stringify(answer));
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(500);
  await page.evaluate(() => { const t = document.querySelector('#b-results .vx-top'); window.scrollTo({ top: window.scrollY + t.getBoundingClientRect().top - 72, behavior: 'instant' }); });
  await page.waitForTimeout(250);
  const fold = await page.evaluate(() => { const b = (s) => { const e = document.querySelector('#b-results ' + s); return e ? Math.round(e.getBoundingClientRect().bottom) : 99999; };
    return { conf: b('.vx-conf'), next: b('.vx-next'), h: innerHeight, inActions: !!document.querySelector('#b-results .vx-actions [data-onclick="k0"]'), fab: !!document.querySelector('.print-fab') }; });
  ok('at 1280 × 800 confidence and Next sit on the first screen; Print is one of the answer\'s actions, nothing floats over it',
     fold.conf <= fold.h && fold.next <= fold.h && fold.inActions && !fold.fab, JSON.stringify(fold));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(400);
  // v3.9.0: the recommended regimen's first dose can be timed — typed "1200" (no colon) reads
  // 12:00; the line follows it with the level by then. v3.11.0: "change" opens the date and
  // time and puts the cursor in the date.
  // Tomorrow, typed segment by segment (MMDDYYYY) the way a keyboard user does — a full
  // re-render on each segment once made the date untypable (final review, v3.9.0).
  const DAY1 = day(1);
  await page.locator('#b-results [data-onclick="k83"]').click(); await page.waitForTimeout(150);
  const opened = await page.evaluate(() => ({ focus: document.activeElement && document.activeElement.id,
    expanded: document.querySelector('#b-results [data-onclick="k83"]').getAttribute('aria-expanded'), shown: !!document.getElementById('b-first-edit').offsetParent }));
  ok('"change" opens the first dose\'s date and time and focuses the date', opened.focus === 'b-first-date' && opened.expanded === 'true' && opened.shown, JSON.stringify(opened));
  { const [yy, mm, dd] = DAY1.split('-'); await page.locator('#b-first-date').focus(); await page.keyboard.type(mm + dd + yy); await page.waitForTimeout(300); }
  await typeInto(page, '#b-first-time', '1200'); await page.locator('#b-first-time').press('Tab');
  await page.waitForTimeout(400);
  const first = await page.evaluate(() => ({ t: (document.getElementById('b-first-time') || {}).value, d: (document.getElementById('b-first-date') || {}).value,
    line: ((document.querySelector('#b-results .vx-first') || {}).textContent || '').replace(/\s+/g, ' '),
    level: /level by then [\d.]+ mg\/L/.test((document.querySelector('#b-results .vx-first') || {}).textContent || '') }));
  ok('the first dose of the recommended regimen can be timed; the readout follows the typed time',
     first.d === DAY1 && first.t === '12:00' && /12:00/.test(first.line) && first.level, JSON.stringify(first));
  // Final review (v3.11.0): after the edit the first-day slot says the band only when the number
  // shown is outside it; a second "change" closes the date and time.
  const slot = await page.evaluate(() => (document.getElementById('b-first-auc') || {}).textContent || '');
  const sm = slot.match(/First 24 h AUC₂₄ (\d+), (below|above) 400–600/);
  await page.locator('#b-results [data-onclick="k83"]').click(); await page.waitForTimeout(150);
  const closed = await page.evaluate(() => ({ hidden: document.getElementById('b-first-edit').hidden,
    expanded: document.querySelector('#b-results [data-onclick="k83"]').getAttribute('aria-expanded') }));
  ok('after the edit the first-day AUC is said only outside 400–600, on the number shown; "change" closes again',
     (slot.trim() === '' || (sm && (sm[2] === 'below' ? +sm[1] < 400 : +sm[1] > 600))) && closed.hidden && closed.expanded === 'false', JSON.stringify({ slot, closed }));
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

  // D27: a resize or a theme change redraws the canvases and the strip; it does not rebuild the
  // result. Every evidence section open, a typed value, the first-dose editor open with its date
  // focused: all of it, and the announcer, survive. A soft keyboard (a height-only change at 375 px)
  // is the same case on a phone.
  {
    const snap = () => page.evaluate(() => ({
      open: [...document.querySelectorAll('#b-results details')].filter(d => d.open).length,
      all: document.querySelectorAll('#b-results details').length,
      tink: (document.getElementById('b-tink-dose') || {}).value, focus: document.activeElement && document.activeElement.id,
      editOpen: !document.getElementById('b-first-edit').hidden, said: (document.getElementById('sr-announce') || {}).textContent || '',
      same: !!document.querySelector('#b-results .vx-top') && document.querySelector('#b-results .vx-top').__d27 === true }));
    await page.evaluate(() => { document.querySelectorAll('#b-results details').forEach(d => { d.open = true; });
      document.querySelector('#b-results .vx-top').__d27 = true; });
    await typeInto(page, '#b-tink-dose', '1750');
    if (await page.locator('#b-results [data-onclick="k83"]').getAttribute('aria-expanded') !== 'true') await page.locator('#b-results [data-onclick="k83"]').click();
    await page.locator('#b-first-date').focus(); await page.waitForTimeout(200);
    const before = await snap();
    // The theme is switched by its function, not a click: a click would move focus to the button, which is its own effect.
    await page.setViewportSize({ width: 1300, height: 900 }); await page.waitForTimeout(500);
    await page.evaluate(() => toggleTheme()); await page.waitForTimeout(500);
    const after = await snap();
    await page.evaluate(() => toggleTheme()); await page.waitForTimeout(300);
    ok('D27: resize and a theme change keep the result\'s state (sections, typed value, focus, one announcement)',
       before.all > 3 && before.open === before.all && before.tink === '1750' && before.focus === 'b-first-date' && before.editOpen
       && after.open === before.open && after.tink === '1750' && after.focus === 'b-first-date' && after.editOpen
       && after.said === before.said && after.same, JSON.stringify({ before, after }));
    const inkD = await canvasInk(page, '#b-profile-canvas');
    ok('D27: the canvas is still drawn after the redraw', inkD.painted > 500, JSON.stringify(inkD));
    // A soft keyboard: width unchanged, height shrinks.
    await page.setViewportSize({ width: 375, height: 812 }); await page.waitForTimeout(500);
    await page.locator('#b-first-time').focus(); await page.keyboard.type('123'); await page.waitForTimeout(200);
    const k1 = await snap(), t1 = await page.locator('#b-first-time').inputValue();
    await page.setViewportSize({ width: 375, height: 500 }); await page.waitForTimeout(500);
    const k2 = await snap(), t2 = await page.locator('#b-first-time').inputValue();
    ok('D27: a soft keyboard (375 px, height only) leaves the first-dose editor open, the focus and the typed value',
       k1.editOpen && k2.editOpen && k1.focus === 'b-first-time' && k2.focus === 'b-first-time' && !!t1 && t2 === t1
       && k2.tink === '1750' && k2.open === k2.all && k2.said === k1.said && k2.same, JSON.stringify({ t1, t2, f: [k1.focus, k2.focus], e: [k1.editOpen, k2.editOpen], s: k2.said === k1.said, o: k2.open, same: k2.same }));
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(400);
    await page.evaluate(() => { document.getElementById('b-first-time').blur(); });
  }

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
  // The stale check above typed SCr 1.3 here only; the Trough column still holds this patient's
  // 1.0. Since v3.14.0 (D26, D-e) a save is refused while the two columns disagree on a shared
  // field, so the AUC value is put back to match before saving.
  const troughScr = await page.evaluate(() => document.getElementById('scr').value);
  if (troughScr) await typeInto(page, '#b-scr', troughScr);
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
  // v3.13.0 (D24): a date and a 24-hour time (typed without a colon), read back, composed
  // into the one instant the engine reads.
  await page.locator('#time-dose-given-date').fill(D2); await typeInto(page, '#time-dose-given-time', '0800');
  await page.locator('#time-level-drawn-date').fill(D2); await typeInto(page, '#time-level-drawn-time', '1930');
  const pair = await page.evaluate(() => { const pl = document.querySelector('.app-shell:not(#app-shell-bayesian) > .panel-left').getBoundingClientRect();
    const t = document.getElementById('time-level-drawn-time').getBoundingClientRect();
    return { v: document.getElementById('time-level-drawn').value, rb: document.getElementById('time-level-drawn-rb').textContent, fits: t.right <= pl.right + 0.5,
      delta: (document.getElementById('time-delta-val') || {}).textContent || '' }; });
  ok('D24: the steady-state level time is a date and a 24-hour time, read back, inside its column', pair.v === `${D2}T19:30` && /^\d{1,2} [A-Z][a-z]{2} 19:30$/.test(pair.rb) && pair.fits && /11/.test(pair.delta), JSON.stringify(pair));
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
  // D24: Enter in "Try another regimen" predicts; it used to recalculate, closing the section.
  await page.evaluate(() => { document.getElementById('tx-ev-tinker').dataset.mark = 'kept'; });
  await typeInto(page, '#tinker-dose-ss', '1500'); await page.locator('#tinker-dose-ss').press('Enter'); await page.waitForTimeout(400);
  const txEnter = await page.evaluate(() => { const d = document.getElementById('tx-ev-tinker'); return { kept: d && d.dataset.mark === 'kept', open: d && d.open,
    key: ([...document.querySelectorAll('#tinker-result-ss .tink-legend .legend-item')][0] || {}).textContent || '' }; });
  ok('D24: Enter in "Try another regimen" predicts and keeps the section open', txEnter.kept && txEnter.open && /^Trying 1\.5 g IV q8h/.test(txEnter.key.trim()), JSON.stringify(txEnter));
  const txInk = await canvasInk(page, '#tx-tink-canvas-ss');
  ok('the Trough comparison is drawn', txInk.w > 0 && txInk.painted > 0, JSON.stringify(txInk));
  await page.evaluate(() => { const el = document.getElementById('tinker-result-ss'); window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 80, behavior: 'instant' }); });
  await page.waitForTimeout(200);
  await page.locator('#tinker-result-ss').screenshot({ path: path.join(OUT, 'desktop-trough-tinker.png') });
  // The dose explorer marks the rows the chart draws with the chart key's line and word (D14):
  // the current regimen on the fit's line, the recommendation on the projection's. (Since D26 a
  // row over a ceiling carries is-over too; the key's rows are the is-cur / is-rec / is-opt ones.)
  const xRows = await page.evaluate(() => [...document.querySelectorAll('#tx-ev-explorer tbody tr.is-cur, #tx-ev-explorer tbody tr.is-rec, #tx-ev-explorer tbody tr.is-opt')].map(r => ({
    cls: r.className, key: (r.querySelector('.tx-row-tag .lg') || {}).className || '',
    text: r.querySelector('th').textContent.replace(/\s+/g, ' ').trim() })));
  ok('dose explorer keys the chart\'s regimens: current on the fit\'s line, recommended on the projection\'s',
     // The fitted current 1 g q12h is over AUC24 700 here, so its row also says so (D26 review).
     xRows.length === 2 && xRows.some(r => /^is-cur( is-over)?$/.test(r.cls) && /lg-ind/.test(r.key) && /^1 g q12h current( AUC₂₄ over 700)?$/.test(r.text)) &&
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
  // v3.11.0 (D22): beside an HD answer, no open q-interval world — Regimens closed and after
  // Haemodialysis, no weight-based guideline regimen, no q-interval projection row.
  const hdLayout = await m.evaluate(() => { const ids = [...document.querySelectorAll('#b-results details.ev')].map(d => d.id), rg = document.getElementById('ev-regimens');
    return { ids, regOpen: !!rg && rg.open, guideline: !!document.querySelector('#b-results .guideline-line'), proj: !!document.getElementById('b-proj-fwd'),
      advice: ((document.querySelector('#ev-models .ev-banner') || {}).textContent || '').replace(/\s+/g, ' ').trim() }; });
  ok('HD: Regimens closed and after Haemodialysis; no guideline regimen; no projection row',
     hdLayout.ids.indexOf('ev-regimens') > hdLayout.ids.indexOf('ev-hd') && hdLayout.ids.indexOf('ev-hd') >= 0 && !hdLayout.regOpen && !hdLayout.guideline && !hdLayout.proj, JSON.stringify(hdLayout));
  ok('HD: the model advice names Goti-HD and suggests no model without dialysis',
     /Model matches patient profile: On intermittent haemodialysis/.test(hdLayout.advice) && !/Buelga|Hughes/.test(hdLayout.advice), hdLayout.advice);
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
  // D17: no session ahead → a one-time answer, the missed post-HD dose flagged; the 72 h
  // button re-sizes it without refitting and keeps keyboard focus.
  await m.locator('[data-onclick="k2"]').tap();
  for (const id of [5, 4, 3, 2]) { const x = m.locator(`[data-onclick="k75"][data-arg="${id}"]`); if (await x.count()) await x.tap(); }
  await m.locator('[data-onclick="k61"][data-arg="4"]').tap();          // the D2 20:00 dose: nothing after session 1 now
  await m.locator('[data-onclick="k46"]').tap();
  const lv = await m.evaluate(() => [...document.querySelectorAll('[id^="b-lvl-conc-"]')].pop().id.split('-').pop());
  await typeInto(m, `#b-lvl-conc-${lv}`, '10.3'); await m.locator(`#b-lvl-date-${lv}`).fill(D2); await typeInto(m, `#b-lvl-time-${lv}`, '23:30');
  await m.locator('[data-onclick="k47"]').tap();
  await m.waitForFunction(() => /One-time|No dose now/.test((document.querySelector('#b-results .vx-verdict') || {}).textContent || ''), null, { timeout: 20000 });
  await m.waitForTimeout(300);
  const ot = await m.evaluate(() => ({ head: document.getElementById('vx-regimen').textContent.replace(/\s+/g, ' ').trim(),
    oneTime: /One-time|No dose now/.test(document.querySelector('.vx-verdict').textContent),
    missed: /No dose entered after session 1/.test(document.querySelector('.vx-verdict').textContent),
    btns: [...document.querySelectorAll('#b-results [data-onclick="k78"]')].map(b => b.dataset.arg + ':' + b.getAttribute('aria-pressed')),
    sw: document.documentElement.scrollWidth, iw: innerWidth }));
  ok('HD one-time: no session ahead → a one-time answer, the missed post-HD dose flagged, fits 375 px',
     ot.oneTime && /IV now|No dose now|Planned/.test(ot.head) && ot.missed && ot.btns.join() === '24:false,48:true,72:false' && ot.sw <= ot.iw, JSON.stringify(ot));
  {
    const paper = await m.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return ((document.getElementById('print-report') || {}).textContent || '').replace(/\s+/g, ' '); });
    ok('D26: print says not clinically validated (HD result)', /not clinically validated/.test(paper) && /Clinician judgment required/.test(paper) && paper.length > 200, paper.slice(-300));
  }
  await m.evaluate(() => { const el = document.querySelector('#b-results .vx-top'); window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 64, behavior: 'instant' }); });
  await m.waitForTimeout(250);
  await m.screenshot({ path: path.join(OUT, 'mobile-hd-onetime.png') });
  await m.locator('#b-results [data-onclick="k78"][data-arg="72"]').focus();
  await m.keyboard.press('Enter');
  await m.waitForFunction(() => /72 h/.test((document.querySelector('.vx-verdict') || {}).textContent || ''), null, { timeout: 5000 });
  const ot72 = await m.evaluate(() => ({ said: /starts (<strong>)?72 h|starts 72 h|72 h after/.test(document.querySelector('.vx-verdict').innerHTML),
    pressed: document.querySelector('#b-results [data-onclick="k78"][data-arg="72"]').getAttribute('aria-pressed'),
    focus: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.arg : null }));
  ok('HD one-time: the 72 h button re-sizes for 72 h without refitting, and keeps focus',
     ot72.said && ot72.pressed === 'true' && ot72.focus === '72', JSON.stringify(ot72));
  // v3.8.0: a later give-at time, typed, moves the dose in the answer; the assumed next HD stays
  // anchored to the last session's start. Only when the answer is a dose (the give-at row exists).
  if (await m.locator('#b-hd-give-time').count()) {
    await m.locator('#b-hd-give-date').fill(day(1));
    await m.waitForTimeout(300);
    await typeInto(m, '#b-hd-give-time', '1000'); await m.locator('#b-hd-give-time').press('Tab');   // a phone keypad has no colon
    await m.waitForTimeout(400);
    const give = await m.evaluate(() => ({ inf: document.querySelector('.vx-verdict .vx-inf').textContent.replace(/\s+/g, ' '),
      time: (document.getElementById('b-hd-give-time') || {}).value, anchored: /after session \d+ began/.test(document.querySelector('.vx-verdict').textContent) }));
    ok('HD one-time: a typed give-at time moves the dose in the answer; the next HD stays anchored to the last session',
       /10:00/.test(give.inf) && give.time === '10:00' && give.anchored, JSON.stringify(give));
  } else ok('HD one-time: a typed give-at time moves the dose in the answer; the next HD stays anchored to the last session', false, 'no give-at row: this fixture must give a dose');
  const mAttr = await attributeInjected(m, mProblems);
  results.cloudflareInjected += mAttr.injected;
  results.problems.push(...mAttr.kept);
  await mctx.close();

  // v3.10.0 (D21): an obese patient before the first level gets the CrCl weight spread —
  // IBW / AdjBW (used) / TBW, each with CL and AUC24 — and it goes once a manual CrCl is
  // set (the clinician chose it) or a level is entered (the clearance estimates take over).
  {
    const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const s = await sctx.newPage();
    // A fixed "now" (today 23:00), so the "now on the axis" check below cannot pass by the time
    // of day: the dose yesterday at 16:00 has its curve's natural end well before it.
    await s.clock.setFixedTime(new Date(`${day(0)}T23:00`));
    const sProblems = watch(s, 'spread');
    await s.goto(BASE + '?v=pws-' + Date.now(), { waitUntil: 'networkidle' });
    await s.locator('[data-onclick="k2"]').click();
    await typeInto(s, '#b-age', '34'); await typeInto(s, '#b-tbw', '118'); await typeInto(s, '#b-height', '165'); await typeInto(s, '#b-scr', '0.55');
    await s.locator('[data-onclick="k40"]').click();
    await s.locator('[data-onclick="k43"]').click();
    await typeInto(s, '#b-dose-mg-1', '1000'); await s.locator('#b-dose-date-1').fill(D2); await typeInto(s, '#b-dose-time-1', '16:00');
    const run = async () => { await s.locator('[data-onclick="k47"]').click(); await s.waitForSelector('#b-results .rec-dose', { timeout: 20000 }); await s.waitForTimeout(300); };
    const spreadNote = () => s.evaluate(() => { const n = [...document.querySelectorAll('#b-results .note')].find(x => /CrCl depends on the weight used/.test(x.textContent));
      return n ? n.textContent.replace(/\s+/g, ' ') : ''; });
    await run();
    const t1 = await spreadNote();
    ok('obese, no level: the CrCl weight spread names IBW, AdjBW (used) and TBW, each with CL and AUC24, SCr as measured',
       /IBW [\d.]+ kg/.test(t1) && /AdjBW [\d.]+ kg, used/.test(t1) && /TBW 118\.0 kg/.test(t1) && (t1.match(/AUC₂₄ \d+/g) || []).length === 3
       && (t1.match(/CL [\d.]+ L\/h/g) || []).length === 3 && /SCr 0\.55 mg\/dL as measured/.test(t1), t1.slice(0, 400));
    // One renal note, not two: the augmented-clearance advisory carries the weights (the user's review).
    const renal = await s.evaluate(() => { const ns = [...document.querySelectorAll('#b-results .note')].filter(n => !n.closest('details'));
      return ns.map(n => n.textContent.replace(/\s+/g, ' ')).filter(t => /Augmented renal clearance|CrCl depends on the weight used/.test(t)); });
    ok('one renal note on screen: the augmented-clearance advisory carries the weights, its actions under "if truly augmented"',
       renal.length === 1 && /Augmented renal clearance suspected/.test(renal[0]) && /CrCl depends on the weight used/.test(renal[0])
       && /If clearance is truly augmented:/.test(renal[0]), JSON.stringify(renal).slice(0, 400));
    // v3.11.0 (D22), before any level: sections with nothing to show are one line; no
    // "population estimate only" note; "now" is on the time axis (one dose yesterday).
    const pre = await s.evaluate(() => ({ ids: [...document.querySelectorAll('#b-results details.ev')].map(d => d.id),
      empty: [...document.querySelectorAll('#b-results .ev-empty')].map(p => p.textContent.replace(/\s+/g, ' ').trim()),
      popNote: /Population estimate only/.test(document.getElementById('b-results').textContent),
      now: !!document.querySelector('#b-course-strip line.now') }));
    // Models stays: at BMI 43 it carries the model advice (Hughes), so it has something to show.
    ok('before a level: empty sections are one line saying what each needs; no population-only note; "now" on the axis',
       pre.empty.length === 1 && /Current regimen needs more maintenance doses to read a schedule\. Fit vs measured needs a measured level\./.test(pre.empty[0])
       && !pre.ids.includes('ev-current') && !pre.ids.includes('ev-fit') && pre.ids.includes('ev-models') && !pre.popNote && pre.now, JSON.stringify(pre));
    await s.locator('[data-onclick="k1"]').click();
    await s.locator('#crcl-override-on').check();
    await typeInto(s, '#crcl-override-val', '117');
    await s.locator('[data-onclick="k2"]').click();
    await run();
    ok('a manual CrCl removes the spread (the clinician chose the CrCl)', !(await spreadNote()));
    await s.locator('[data-onclick="k1"]').click();
    await s.locator('#crcl-override-on').uncheck();
    await s.locator('[data-onclick="k2"]').click();
    // Final review (v3.10.0): a redraw (resize, rotation, theme) re-renders the result; it must
    // read the override as it was at the fit, not as it is now.
    await s.setViewportSize({ width: 1100, height: 900 }); await s.waitForTimeout(600);
    ok('unticking the override after the fit does not bring the spread back on a redraw', !(await spreadNote()));
    await s.locator('[data-onclick="k46"]').click();
    await typeInto(s, '#b-lvl-conc-1', '9.4'); await s.locator('#b-lvl-date-1').fill(D2); await typeInto(s, '#b-lvl-time-1', '22:00');
    await run();
    ok('a level removes the spread (the clearance estimates take over)', !(await spreadNote()));
    const sAttr = await attributeInjected(s, sProblems);
    results.cloudflareInjected = (results.cloudflareInjected || 0) + sAttr.injected;
    results.problems.push(...sAttr.kept);
    await sctx.close();
  }

  // v3.14.0 (D25): the regimen being given enters the decision. A fictional 55 M (72 kg,
  // 176 cm, SCr 1.0) on 1250 mg q12h with the target box at 400 — where v3.13.0 traded an
  // in-range regimen for whatever sat nearest 400. Then the same patient on 1750 mg q24h,
  // below range, which must change and say why. Fixed clock: today 10:00.
  {
    const cctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const c = await cctx.newPage();
    const cProblems = watch(c, 'continue');
    await c.clock.setFixedTime(new Date(`${day(0)}T10:00`));
    await c.goto(BASE + '?v=pwc-' + Date.now(), { waitUntil: 'networkidle' });
    await c.locator('[data-onclick="k2"]').click();
    await typeInto(c, '#b-age', '55'); await typeInto(c, '#b-tbw', '72'); await typeInto(c, '#b-height', '176'); await typeInto(c, '#b-scr', '1.0');
    await c.locator('[data-onclick="k39"]').click();
    const course = async (mg, times, conc) => {
      for (let n = 1; n <= times.length; n++) {
        await c.locator('[data-onclick="k43"]').click();
        await typeInto(c, `#b-dose-mg-${n}`, mg); await typeInto(c, `#b-dose-tinf-${n}`, mg > 1500 ? '2' : '1.5');
        await c.locator(`#b-dose-date-${n}`).fill(times[n - 1][0]); await typeInto(c, `#b-dose-time-${n}`, times[n - 1][1]);
      }
      await c.locator('[data-onclick="k46"]').click();
      await typeInto(c, '#b-lvl-conc-1', conc); await c.locator('#b-lvl-date-1').fill(day(0)); await typeInto(c, '#b-lvl-time-1', '07:30');
      await typeInto(c, '#b-auc-target', '400');
      await c.locator('[data-onclick="k47"]').click(); await c.waitForSelector('#b-results .rec-dose', { timeout: 20000 }); await c.waitForTimeout(300);
      return c.evaluate(() => ({ act: document.querySelector('#b-results .vx-action')?.textContent || '',
        reg: (document.getElementById('vx-regimen')?.textContent || '').replace(/\s+/g, ' ').trim(),
        why: (document.querySelector('#b-results .vx-why')?.textContent || '').replace(/\s+/g, ' ').trim(),
        delta: !!document.querySelector('#b-results .vx-delta'),
        actFirst: (() => { const a = document.querySelector('#b-results .vx-action'), h = document.getElementById('vx-regimen');
          return !!(a && h && (a.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING)); })(),
        said: document.getElementById('sr-announce')?.textContent || '' }));
    };
    const q12 = await course(1250, [[D1, '08:00'], [D1, '20:00'], [D2, '08:00'], [D2, '20:00']], 16);
    ok('D25: an in-range 1.25 g q12h is continued at a target box of 400, said before the regimen, with why and the target-box alternative',
       q12.act === 'Continue the current regimen' && q12.actFirst && q12.reg === '1.25 g IV q12h' && !q12.delta
       && /^Within 400–600 at AUC₂₄ \d+ with \d+ of 20 plausible AUCs in range; no admissible regimen puts 2 or more further in range\. Your target of 400 alone would give .+ \(AUC₂₄ \d+, \d+ of 20 in range\)\.$/.test(q12.why),
       JSON.stringify(q12));
    ok('D25: the screen reader hears "continue"', /^Result: continue 1\.25 g IV q12h, AUC24 \d+/.test(q12.said), q12.said);
    const printed = await c.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return (document.getElementById('print-report') || {}).textContent.replace(/\s+/g, ' '); });
    ok('D26: print says not clinically validated (AUC result)', /not clinically validated/.test(printed) && /Clinician judgment required/.test(printed) && !/Advisory only/.test(printed), printed.slice(-300));
    ok('D25: the printed report says continue and why, as on screen', /Continue the current regimen\s*1\.25 g IV q12h/.test(printed) && /no admissible regimen puts 2 or more further in range/.test(printed),
       printed.slice(printed.indexOf('Dose recommendation'), printed.indexOf('Dose recommendation') + 600));
    await c.goto(BASE + '?v=pwc2-' + Date.now(), { waitUntil: 'networkidle' });
    await c.locator('[data-onclick="k2"]').click();
    await typeInto(c, '#b-age', '55'); await typeInto(c, '#b-tbw', '72'); await typeInto(c, '#b-height', '176'); await typeInto(c, '#b-scr', '1.0');
    await c.locator('[data-onclick="k39"]').click();
    const q24 = await course(1750, [[day(-3), '08:00'], [D1, '08:00'], [D2, '08:00']], 6);
    ok('D25: a below-range 1.75 g q24h changes, naming what it changes from and the in-range gain',
       /^Change from 1\.75 g IV q24h$/.test(q24.act) && q24.actFirst && q24.delta
       && /^The current regimen gives AUC₂₄ (3\d\d) with (\d+) of 20 plausible AUCs in 400–600; this one puts (\d+) of 20 in range\./.test(q24.why)
       && (m => !!m && +m[2] > +m[1])(q24.why.match(/with (\d+) of 20[\s\S]*puts (\d+) of 20/)),
       JSON.stringify(q24));
    // v3.14.0 (D26), UI report I2 (ruling R1): the last 1.75 g q24h dose went in yesterday 08:00, so
    // the next was due today 08:00 — never "was due yesterday 20:00" (the new q12h's due time).
    const dueRead = await c.evaluate(() => {
      const first = (document.getElementById('b-first-readout') || {}).textContent || '';
      window.dispatchEvent(new Event('beforeprint'));
      const paper = ((document.getElementById('print-report') || {}).textContent || '').replace(/\s+/g, ' ');
      const i = paper.indexOf('First dose');
      return { first: first.replace(/\s+/g, ' ').trim(), paper: i < 0 ? '' : paper.slice(i, i + 200) };
    });
    const dd = (n) => { const d = new Date(`${day(n)}T12:00`);
      return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`; };
    ok('D26: on a change from q24h to q12h, "current q24h dose was due" today 08:00, on screen and in print, offset against the current q24h',
       dueRead.first.startsWith(`${dd(0)} 10:00 (current q24h dose was due ${dd(0)} 08:00)`) && !dueRead.first.includes(`${dd(-1)} 20:00`)
       && dueRead.paper.includes(`First dose ${dd(0)} 10:00 (current q24h dose was due ${dd(0)} 08:00)`) && /2 h after the current q24h schedule/.test(dueRead.paper),
       JSON.stringify(dueRead));
    // v3.14.0 (D26): saving while the result is stale keeps the stale mark. The 1.75 g q24h
    // fit above is still on screen; change SCr so it is stale, then save with and without a label.
    await typeInto(c, '#b-scr', '1.4'); await c.waitForTimeout(300);
    const staleState = () => c.evaluate(() => ({
      line: !!document.querySelector('#b-results .stale-line, .panel-right .stale-line'),
      cls: document.getElementById('b-results').classList.contains('is-stale'),
      result: !!bState.result }));
    const stale0 = await staleState();
    await c.locator('[data-onclick="k37"]:visible').first().click(); await c.waitForTimeout(200);
    const staleA = await staleState();
    await c.locator('.profile-label-input:visible').first().fill('D26 stale');
    await c.locator('[data-onclick="k37"]:visible').first().click(); await c.waitForTimeout(300);
    const staleB = await staleState();
    const savedSnap = await c.evaluate(() => { const ps = loadProfiles(); const p = ps.find(x => x.label === 'D26 stale'); return p ? { has: true, fit: !!(p.snapshot && p.snapshot.fit) } : { has: false }; });
    ok('D26: saving while stale keeps the stale mark (empty label, then labelled), and the profile holds no fit',
       stale0.line && stale0.cls && stale0.result
       && staleA.line && staleA.cls && staleA.result && staleB.line && staleB.cls && staleB.result
       && savedSnap.has && !savedSnap.fit,
       JSON.stringify({ stale0, staleA, staleB, savedSnap }));
    const cAttr = await attributeInjected(c, cProblems);
    results.cloudflareInjected = (results.cloudflareInjected || 0) + cAttr.injected;
    results.problems.push(...cAttr.kept);
    await cctx.close();
  }

  // v3.14.0 (D26), engine report I3: a level dated in the future is refused, naming its row.
  // A fictional 55 M (80 kg, 176 cm, SCr 1.0) on 1.25 g q12h x 4, the last 11 h ago, and a
  // level of 15 mg/L dated 30 h ahead. A planned dose dated ahead is still allowed.
  // Fixed clock: today 10:00.
  {
    const fctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const f = await fctx.newPage();
    const fProblems = watch(f, 'future-level');
    await f.clock.setFixedTime(new Date(`${day(0)}T10:00`));
    await f.goto(BASE + '?v=fut-' + Date.now(), { waitUntil: 'networkidle' });
    await f.locator('[data-onclick="k2"]').click();
    await typeInto(f, '#b-age', '55'); await typeInto(f, '#b-tbw', '80'); await typeInto(f, '#b-height', '176'); await typeInto(f, '#b-scr', '1.0');
    await f.locator('[data-onclick="k39"]').click();
    const when = [[day(-2), '11:00'], [day(-2), '23:00'], [day(-1), '11:00'], [day(-1), '23:00']];
    for (let n = 1; n <= when.length; n++) {
      await f.locator('[data-onclick="k43"]').click();
      await typeInto(f, `#b-dose-mg-${n}`, '1250'); await typeInto(f, `#b-dose-tinf-${n}`, '1.5');
      await f.locator(`#b-dose-date-${n}`).fill(when[n - 1][0]); await typeInto(f, `#b-dose-time-${n}`, when[n - 1][1]);
    }
    await f.locator('[data-onclick="k46"]').click();
    await typeInto(f, '#b-lvl-conc-1', '15'); await f.locator('#b-lvl-date-1').fill(day(1)); await typeInto(f, '#b-lvl-time-1', '16:00');
    await f.locator('[data-onclick="k47"]').click(); await f.waitForTimeout(600);
    const futState = () => f.evaluate(() => ({ err: (document.getElementById('fe-auc') || {}).textContent || '', result: !!bState.result,
      rec: !!document.querySelector('#b-results .rec-dose'), invalid: ['b-lvl-date-1', 'b-lvl-time-1'].some(i => { const e = document.getElementById(i); return e.getAttribute('aria-invalid') === 'true' || e.classList.contains('fe-invalid'); }) }));
    const fut = await futState();
    ok('D26: a level dated 30 h ahead is refused, naming "Level row 1", with no result',
       /Level row 1/.test(fut.err) && /future/.test(fut.err) && !fut.result && !fut.rec && fut.invalid, JSON.stringify({ result: fut.result, rec: fut.rec, invalid: fut.invalid, err: fut.err.replace(/\s+/g, ' ').trim().slice(0, 80) }));
    ok('D26: the future-level refusal gives the year with the date (final review, R26)', fut.err.indexOf(day(1).slice(0, 4)) > 0, fut.err.replace(/\s+/g, ' ').trim().slice(0, 140));
    await f.locator('#b-lvl-date-1').fill(day(0)); await typeInto(f, '#b-lvl-time-1', '07:30');
    await f.locator('[data-onclick="k47"]').click(); await f.waitForSelector('#b-results .rec-dose', { timeout: 20000 });
    const fixed = await futState();
    ok('D26: the same level dated in the past is fitted', fixed.result && fixed.rec && !/Level row/.test(fixed.err), JSON.stringify(fixed));
    const fAttr = await attributeInjected(f, fProblems);
    results.cloudflareInjected = (results.cloudflareInjected || 0) + fAttr.injected;
    results.problems.push(...fAttr.kept);
    await fctx.close();
  }

  // v3.14.0 (D26), saved profiles: engine report I4 (P1) and I5 (P2), code report I2 and I5, and
  // Review Focus 2. Fictional patients A–D only; the v3.13.0 fixture is fictional too.
  {
    const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const s = await sctx.newPage();
    const sProblems = watch(s, 'profiles');
    await s.goto(BASE + '?v=prof-' + Date.now(), { waitUntil: 'networkidle' });
    const KEY = 'ainadara.profiles.v1';
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const save = async (label) => {
      await s.locator('.profile-label-input:visible').first().fill(label);
      await s.locator('[data-onclick="k37"]:visible').first().click(); await s.waitForTimeout(250);
    };
    const stored = () => s.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), KEY);
    const profileErr = () => s.evaluate(() => ((document.querySelector('.fe-profile') || {}).textContent || '').replace(/\s+/g, ' ').trim());
    const statusLine = () => s.evaluate(() => [...document.querySelectorAll('.profile-status')].map(p => p.textContent).join(' '));
    // P1: patient A (80 F, 50 kg, 150 cm, SCr 2.5, two doses, one level) in AUC Precision.
    await s.locator('[data-onclick="k2"]').click();
    await typeInto(s, '#b-age', '80'); await typeInto(s, '#b-tbw', '50'); await typeInto(s, '#b-height', '150'); await typeInto(s, '#b-scr', '2.5');
    await s.locator('[data-onclick="k40"]').click();
    for (const [n, d] of [[1, D1], [2, D2]]) {
      await s.locator('[data-onclick="k43"]').click();
      await typeInto(s, `#b-dose-mg-${n}`, '1000'); await typeInto(s, `#b-dose-tinf-${n}`, '1');
      await s.locator(`#b-dose-date-${n}`).fill(d); await typeInto(s, `#b-dose-time-${n}`, '08:00');
    }
    await s.locator('[data-onclick="k46"]').click();
    await typeInto(s, '#b-lvl-conc-1', '18'); await s.locator('#b-lvl-date-1').fill(D2); await typeInto(s, '#b-lvl-time-1', '07:30');
    // Trough-Based: clear the column, type patient B (30 M, 90 kg, 185 cm, SCr 0.8) and save.
    await s.locator('[data-onclick="k1"]').click();
    await s.locator('[data-onclick="k32"]:visible').first().click();
    await typeInto(s, '#age', '30'); await typeInto(s, '#tbw', '90'); await typeInto(s, '#height', '185'); await typeInto(s, '#scr', '0.8');
    await s.locator('[data-onclick="k9"]').click();
    await save('Patient B');
    const p1Err = await profileErr(), p1Store = await stored();
    // R18: empty only the AUC column's patient fields, by hand, leaving patient A's doses and level. The
    // Trough save then holds patient B alone, without that course, and the status line says so.
    await s.locator('[data-onclick="k2"]').click();
    for (const id of ['#b-age', '#b-tbw', '#b-height', '#b-scr']) await s.locator(id).fill('');
    await s.locator('[data-onclick="k1"]').click();
    await save('Patient B');
    const p1Ok = await stored(), pb = p1Ok[0] && p1Ok[0].snapshot, p1Status = await statusLine();
    ok('D26: a Trough save refuses a mixed patient',
       ['Age: Trough-Based 30, AUC Precision 80', 'Weight: Trough-Based 90, AUC Precision 50', 'Height: Trough-Based 185, AUC Precision 150',
        'Serum creatinine: Trough-Based 0.8, AUC Precision 2.5'].every(x => p1Err.includes(x)) && !/Clear the column/.test(p1Err) && p1Store.length === 0
       && p1Ok.length === 1 && !!pb && pb.core.age === '30' && pb.core.tbw === '90' && pb.core.height === '185' && pb.core.scr === '0.8' && pb.core.sex === 'M'
       && pb.doses.length === 0 && pb.levels.length === 0 && /AUC Precision course not saved/.test(p1Status),
       JSON.stringify({ p1Err, p1Store: p1Store.length, core: pb && pb.core, doses: pb && pb.doses.length, levels: pb && pb.levels.length, p1Status }));

    // P2: patient C (45 F, 70 kg, 168 cm, SCr 0.9, no cystatin C) saved from AUC Precision; then
    // patient D in Trough (82 F, 55 kg, 160 cm, SCr 1.9, cystatin C 2.4, baseline SCr 0.8, steady-state
    // level mode, dose 1,500, level 31), and Patient C loaded from the Trough column's list.
    await s.locator('[data-onclick="k32"]:visible').first().click();
    await s.locator('[data-onclick="k2"]').click();
    await s.locator('[data-onclick="k48"]:visible').first().click();   // patient A's course goes too
    await typeInto(s, '#b-age', '45'); await typeInto(s, '#b-tbw', '70'); await typeInto(s, '#b-height', '168'); await typeInto(s, '#b-scr', '0.9');
    await s.locator('[data-onclick="k40"]').click();
    await save('Patient C');
    await s.locator('[data-onclick="k1"]').click();
    await s.locator('[data-onclick="k32"]:visible').first().click();
    await typeInto(s, '#age', '82'); await typeInto(s, '#tbw', '55'); await typeInto(s, '#height', '160'); await typeInto(s, '#scr', '1.9');
    await s.locator('[data-onclick="k10"]').click();
    await typeInto(s, '#cysc', '2.4'); await typeInto(s, '#scr-baseline', '0.8');
    await s.locator('#mode-btn-level').click();
    await typeInto(s, '#dose', '1500');
    await s.evaluate(() => { const x = document.getElementById('has-level'); if (x && !x.checked) x.click(); });
    await typeInto(s, '#level-val', '31');
    await s.locator('#t-hd').check();   // patient D is on haemodialysis; patient C is not
    const advisories = () => s.evaluate(() => {
      const shown = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && e.textContent.trim() !== ''; };
      return { cys: shown('cysc-result'), aki: shown('aki-banner') };
    });
    const p2Before = await advisories();
    await s.locator('.app-shell:not(#app-shell-bayesian) .profile-item', { hasText: 'Patient C' }).locator('.profile-item-btn.load').click();
    await s.waitForTimeout(300);
    const p2 = Object.assign(await s.evaluate(() => {
      const v = (id) => document.getElementById(id).value;
      return { cysc: v('cysc'), base: v('scr-baseline'), dose: v('dose'), level: v('level-val'), age: v('age'), bAge: v('b-age'), scr: v('scr'),
        hasLevel: document.getElementById('has-level').checked, hd: document.getElementById('t-hd').checked };
    }), await advisories());
    ok('D26: a profile load clears the Trough column',
       p2Before.cys && p2Before.aki
       && p2.cysc === '' && p2.base === '' && p2.dose === '' && p2.level === '' && !p2.hasLevel && !p2.cys && !p2.aki && !p2.hd
       && p2.age === '45' && p2.bAge === '45' && p2.scr === '0.9',
       JSON.stringify({ p2Before, p2 }));

    // R19: a same-patient follow-up. Today's SCr 1.4 typed in AUC Precision only: the save is refused with
    // both values and one action, which copies only that field to Trough-Based; the second save succeeds.
    await s.locator('[data-onclick="k2"]').click();
    await typeInto(s, '#b-scr', '1.4');
    await save('Patient C day 2');
    const r19Err = await profileErr(), r19Store = (await stored()).length;
    const trough = () => s.evaluate(() => Object.fromEntries(['age', 'tbw', 'height', 'scr', 'cysc', 'mic', 'trough-min', 'trough-max', 'b-scr', 'b-mic', 'b-auc-target']
      .map(id => [id, document.getElementById(id).value])));
    const r19Before = await trough();
    const copyBtn = s.locator('.fe-profile [data-onclick="k99"]:visible');
    const copyText = (await copyBtn.textContent() || '').trim();
    await copyBtn.click(); await s.waitForTimeout(200);
    const r19After = await trough();
    await s.locator('[data-onclick="k37"]:visible').first().click(); await s.waitForTimeout(250);
    const r19Saved = (await stored())[0];
    const changed = Object.keys(r19Before).filter(k => r19Before[k] !== r19After[k]);
    ok('D26: a same-patient refusal names both values; its copy action changes only that field and the second save succeeds',
       /Serum creatinine: Trough-Based 0\.9, AUC Precision 1\.4/.test(r19Err) && /match/.test(r19Err) && !/Clear the column/.test(r19Err)
       && copyText === 'Copy the AUC Precision values to Trough-Based' && eq(changed, ['scr']) && r19After.scr === '1.4'
       && !!r19Saved && r19Saved.label === 'Patient C day 2' && r19Saved.snapshot.core.scr === '1.4' && (await stored()).length === r19Store + 1,
       JSON.stringify({ r19Err, copyText, changed, saved: r19Saved && r19Saved.label }));
    await s.locator('[data-onclick="k1"]').click();

    // Code report I5: delete removes one profile of three, and Undo puts it back where it was.
    await s.evaluate((k) => { localStorage.removeItem(k); renderProfileList(); }, KEY);
    for (const l of ['Profile one', 'Profile two', 'Profile three']) await save(l);
    const labels = async () => ({ store: (await stored()).map(p => p.label),
      list: (await s.locator('.app-shell:not(#app-shell-bayesian) .profile-item-label').allTextContents()).map(x => x.trim()) });
    const before3 = await labels();
    await s.locator('.app-shell:not(#app-shell-bayesian) .profile-item', { hasText: 'Profile two' }).locator('.profile-item-btn.delete').click();
    await s.waitForTimeout(200);
    const after3 = await labels();
    await s.locator('.app-shell:not(#app-shell-bayesian) .profile-status [data-onclick="k97"]').click();
    await s.waitForTimeout(200);
    const undone3 = await labels();
    ok('D26: delete removes one profile of three',
       eq(before3.store, ['Profile three', 'Profile two', 'Profile one']) && eq(after3.store, ['Profile three', 'Profile one'])
       && eq(after3.list, ['Profile three', 'Profile one']) && eq(undone3.store, before3.store) && eq(undone3.list, before3.store),
       JSON.stringify({ before3, after3, undone3 }));

    // Review Focus 2: profiles saved by v3.13.0 (core and fit) and before the core (legacy fit) load.
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'profile-fixtures-v3.13.0.json'), 'utf8')).profiles;
    await s.evaluate(([k, list]) => { localStorage.setItem(k, JSON.stringify(list)); renderProfileList(); }, [KEY, fixture]);
    await s.locator('[data-onclick="k2"]').click();
    const loadFix = async (label) => {
      await s.locator('#app-shell-bayesian .profile-item', { hasText: label }).locator('.profile-item-btn.load').click();
      await s.waitForTimeout(300);
      return s.evaluate(() => ({ age: document.getElementById('b-age').value, tAge: document.getElementById('age').value, sex: bState.sex, model: bState.model,
        doses: document.querySelectorAll('[id^="b-dose-row-"]').length, levels: document.querySelectorAll('[id^="b-level-row-"]').length,
        icu: document.getElementById('b-icu').checked, result: !!bState.result, status: [...document.querySelectorAll('.profile-status')].map(p => p.textContent).join('') }));
    };
    const fx1 = await loadFix('Fixture 64F v3.13.0'), fx2 = await loadFix('Fixture 71M legacy');
    const fx3 = await loadFix('Fixture 58M Goti-HD');
    const fx3hd = await s.evaluate(() => ({ tHd: document.getElementById('t-hd').checked, bDial: document.getElementById('b-dial').checked }));
    await s.locator('[data-onclick="k1"]').click();
    await s.locator('[data-onclick="k31"]:visible').first().click(); await s.waitForTimeout(300);
    const fx3trough = await s.evaluate(() => ((document.getElementById('results-content') || {}).textContent || '').replace(/\s+/g, ' '));
    ok('D26: a dialysis profile ticks the Trough haemodialysis flag, and the Trough module refuses (D16)',
       fx3.age === '58' && fx3.model === 'goti' && fx3hd.tHd && fx3hd.bDial && /On haemodialysis/.test(fx3trough) && !/q\d+h/.test(fx3trough.slice(0, 200)),
       JSON.stringify({ fx3, fx3hd, fx3trough: fx3trough.slice(0, 160) }));
    await s.locator('[data-onclick="k2"]').click();
    ok('D26: profiles saved by v3.13.0 and before the patient core load (Review Focus 2)',
       fx1.age === '64' && fx1.tAge === '64' && fx1.sex === 'F' && fx1.model === 'goti' && fx1.doses === 3 && fx1.levels === 1 && !fx1.result
       && fx2.age === '71' && fx2.tAge === '71' && fx2.sex === 'M' && fx2.model === 'buelga' && fx2.doses === 2 && fx2.levels === 0 && fx2.icu && !fx2.result
       && !/could not be read/.test(fx1.status + fx2.status),
       JSON.stringify({ fx1, fx2 }));

    // R20 (engine report M3): Trough "Clear all fields" resets the weight basis and amputation, so a
    // save afterwards does not carry the previous patient's.
    await s.evaluate((k) => { localStorage.removeItem(k); renderProfileList(); }, KEY);
    await s.locator('[data-onclick="k1"]').click();
    await s.locator('[data-onclick="k15"]').click();
    await s.evaluate(() => { const c = document.getElementById('amp-enabled'); if (c && !c.checked) c.click(); });
    await s.locator('#jt-RL-knee').click();
    const r20Prev = await s.evaluate(() => ({ basis: state.dosingWt, amp: Object.assign({}, ampState) }));
    await s.locator('[data-onclick="k32"]:visible').first().click();
    await s.locator('[data-onclick="k2"]').click();
    await s.locator('[data-onclick="k48"]:visible').first().click();
    await typeInto(s, '#b-age', '50'); await typeInto(s, '#b-tbw', '72'); await typeInto(s, '#b-height', '170'); await typeInto(s, '#b-scr', '1.0');
    await s.locator('[data-onclick="k39"]').click();
    await save('Patient E');
    const pe = (await stored())[0];
    const r20Ui = await s.evaluate(() => ({ auto: document.querySelector('[data-onclick="k73"]').classList.contains('active'), ampOn: document.getElementById('amp-enabled').checked }));
    ok('D26: Trough "Clear all fields" resets the weight basis and amputation; the next save carries neither',
       r20Prev.basis === 'IBW' && r20Prev.amp.RL === 'knee'
       && !!pe && pe.label === 'Patient E' && pe.snapshot.core.dosingWt === 'auto' && Object.values(pe.snapshot.core.amputation).every(v => v === null)
       && r20Ui.auto && !r20Ui.ampOn,
       JSON.stringify({ r20Prev, core: pe && { dw: pe.snapshot.core.dosingWt, amp: pe.snapshot.core.amputation }, r20Ui }));

    // R21: a Trough-only haemodialysis patient (58 M, SCr 6.8; the AUC column empty, on its default Buelga)
    // loads with the Trough flag ticked and AUC Precision not on dialysis, so the severe-renal hold stays on.
    await s.locator('[data-onclick="k48"]:visible').first().click();
    await s.locator('[data-onclick="k1"]').click();
    await s.locator('[data-onclick="k32"]:visible').first().click();
    await typeInto(s, '#age', '58'); await typeInto(s, '#tbw', '77'); await typeInto(s, '#height', '174'); await typeInto(s, '#scr', '6.8');
    await s.locator('[data-onclick="k9"]').click();
    await s.locator('#t-hd').check();
    await save('Patient F HD');
    const pf = (await stored())[0];
    await s.locator('#t-hd').uncheck();
    await s.locator('.app-shell:not(#app-shell-bayesian) .profile-item', { hasText: 'Patient F HD' }).locator('.profile-item-btn.load').click();
    await s.waitForTimeout(300);
    const r21 = await s.evaluate(() => ({ tHd: document.getElementById('t-hd').checked, bDial: document.getElementById('b-dial').checked,
      dial: bState.dial, model: bState.model, wrap: getComputedStyle(document.getElementById('b-dial-wrap')).display }));
    ok('D26: a Trough-only haemodialysis profile loads with the Trough flag ticked and AUC Precision not on dialysis (R21)',
       !!pf && pf.snapshot.core.hd === true && pf.snapshot.demographics.dial === false && pf.snapshot.model === 'buelga'
       && r21.tHd && !r21.bDial && r21.dial === false && r21.model === 'buelga' && r21.wrap === 'none',
       JSON.stringify({ stored: pf && { hd: pf.snapshot.core.hd, dial: pf.snapshot.demographics.dial, model: pf.snapshot.model }, r21 }));

    // R22: patient A's PD form; Trough "Clear all fields" empties all of it.
    await s.locator('#mode-btn-pd').click();
    const pdFill = async () => {
      await s.selectOption('#pd-modality', 'ccpd'); await typeInto(s, '#pd-start', '2100'); await typeInto(s, '#pd-hours', '9.5');
      await s.selectOption('#pd-vd', { index: 1 });
      await s.locator('[data-onclick="k86"]').click(); await s.locator('[data-onclick="k88"]').click();
    };
    await pdFill();
    const pdForm = () => s.evaluate(() => ({ modality: document.getElementById('pd-modality').value, start: document.getElementById('pd-start').value,
      hours: document.getElementById('pd-hours').value, vd: document.getElementById('pd-vd').value,
      rows: document.querySelectorAll('#pd-dose-tbody tr, #pd-lvl-tbody tr, #pd-held-tbody tr').length, mode: state.calcMode }));
    const pdBefore = await pdForm();
    await s.locator('[data-onclick="k32"]:visible').first().click();
    const pdAfter = await pdForm();
    // And an AUC save of another patient leaves out a PD form whose Trough patient fields are empty.
    await s.locator('#mode-btn-pd').click();
    await pdFill();
    await s.locator('[data-onclick="k2"]').click();
    await s.locator('[data-onclick="k48"]:visible').first().click();
    await typeInto(s, '#b-age', '50'); await typeInto(s, '#b-tbw', '72'); await typeInto(s, '#b-height', '170'); await typeInto(s, '#b-scr', '1.0');
    await s.locator('[data-onclick="k39"]').click();
    await save('Patient G');
    const pg = (await stored())[0], pgStatus = await statusLine();
    ok('D26: Trough "Clear all fields" empties the PD form, and an AUC save leaves out another patient\'s PD form (R22)',
       pdBefore.modality === 'ccpd' && pdBefore.rows === 2 && pdBefore.vd !== 'bauer'
       && pdAfter.modality === '' && pdAfter.start === '' && pdAfter.hours === '' && pdAfter.vd === 'bauer' && pdAfter.rows === 0 && pdAfter.mode === 'initial'
       && !!pg && pg.label === 'Patient G' && !(pg.snapshot.pd && pg.snapshot.pd.modality) && /Trough-Based PD form not saved/.test(pgStatus),
       JSON.stringify({ pdBefore, pdAfter, pd: pg && pg.snapshot.pd && pg.snapshot.pd.modality, pgStatus }));

    // R23: Clear all fields leaves the PD local settings alone, and a later change to another
    // setting does not write a blank over the stored maximum dose or target peak.
    await s.locator('[data-onclick="k1"]').click();
    await s.locator('#mode-btn-pd').click();
    await s.evaluate(() => { document.querySelector('details.pd-settings').open = true; });
    await s.locator('#pd-set-max').fill('1500'); await s.locator('#pd-set-max').blur();
    await s.locator('#pd-set-peak').fill('30'); await s.locator('#pd-set-peak').blur();
    await s.locator('[data-onclick="k32"]:visible').first().click();
    // Read straight after Clear, before re-entering PD mode refills the fields from storage.
    const setAfterClear = await s.evaluate(() => ({ max: document.getElementById('pd-set-max').value, peak: document.getElementById('pd-set-peak').value }));
    await s.locator('#mode-btn-pd').click();
    await s.evaluate(() => { document.querySelector('details.pd-settings').open = true; });
    const setShown = await s.evaluate(() => ({ max: document.getElementById('pd-set-max').value, peak: document.getElementById('pd-set-peak').value }));
    await s.locator('#pd-set-amlabs').fill('05:30'); await s.locator('#pd-set-amlabs').blur();
    await s.reload({ waitUntil: 'networkidle' });
    const setStored = await s.evaluate(() => JSON.parse(localStorage.getItem('vanco.pd.local') || '{}'));
    await s.locator('#mode-btn-pd').click();
    await s.evaluate(() => { document.querySelector('details.pd-settings').open = true; });
    const setReload = await s.evaluate(() => ({ max: document.getElementById('pd-set-max').value, peak: document.getElementById('pd-set-peak').value }));
    ok('D26: Clear keeps the PD local settings (the maximum dose and target peak survive Clear, a later setting change and a reload)',
       setAfterClear.max === '1500' && setAfterClear.peak === '30' && setShown.max === '1500' && setShown.peak === '30' && setStored.maxDoseMg === 1500 && setStored.targetPeak === 30 && setStored.amLabs === '05:30'
       && setReload.max === '1500' && setReload.peak === '30',
       JSON.stringify({ setAfterClear, setShown, setStored, setReload }));
    await s.evaluate(() => localStorage.removeItem('vanco.pd.local'));

    // Code report I2: truncated JSON in the store is copied to the backup key before anything is
    // written over it, and the status line says so; a save afterwards starts a new list.
    const trunc = '[{"id":"p_trunc1","label":"Truncated","savedAt":1762412400000,"snapshot":{"demographics":{"age":"5';
    await s.evaluate(([k, t]) => { localStorage.setItem(k, t); localStorage.removeItem(k + '.bak'); }, [KEY, trunc]);
    await s.reload({ waitUntil: 'networkidle' });
    const bak = Object.assign(await s.evaluate((k) => ({ bak: localStorage.getItem(k + '.bak'), main: localStorage.getItem(k) }), KEY), { status: await statusLine() });
    await typeInto(s, '#age', '60');
    await save('After the backup');
    const bak2 = Object.assign(await s.evaluate((k) => ({ bak: localStorage.getItem(k + '.bak'), list: JSON.parse(localStorage.getItem(k)).map(p => p.label) }), KEY),
      { status: await statusLine() });
    ok('D26: an unreadable profile store is kept under ainadara.profiles.v1.bak and the status line says so',
       bak.bak === trunc && bak.main === trunc && /could not be read/.test(bak.status) && /ainadara\.profiles\.v1\.bak/.test(bak.status)
       && bak2.bak === trunc && eq(bak2.list, ['After the backup']) && /ainadara\.profiles\.v1\.bak/.test(bak2.status),
       JSON.stringify({ bak: Object.assign({}, bak, { bak: bak.bak && bak.bak.length, main: bak.main && bak.main.length }), bak2: Object.assign({}, bak2, { bak: bak2.bak && bak2.bak.length }) }));
    const sAttr = await attributeInjected(s, sProblems);
    results.cloudflareInjected = (results.cloudflareInjected || 0) + sAttr.injected;
    results.problems.push(...sAttr.kept);
    await sctx.close();
  }

  // v3.14.0 (D26), engine report I2 and UI report I3: "Low confidence … a fit the tool itself does
  // not trust" beside "A further level would add little" and "A further concentration is
  // recommended". One sentence about a further level, in Next; the panels point to it. A fictional
  // 76 M (70 kg, 175 cm, SCr 0.5) on Buelga, 1 g q12h x 4 over 1 h, one level of 19.9 mg/L 11.5 h
  // after the last dose. Fixed clock: today 10:00.
  {
    const nctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const n = await nctx.newPage();
    const nProblems = watch(n, 'next-level');
    await n.clock.setFixedTime(new Date(`${day(0)}T10:00`));
    await n.goto(BASE + '?v=nlv-' + Date.now(), { waitUntil: 'networkidle' });
    await n.locator('[data-onclick="k2"]').click();
    await typeInto(n, '#b-age', '76'); await typeInto(n, '#b-tbw', '70'); await typeInto(n, '#b-height', '175'); await typeInto(n, '#b-scr', '0.5');
    await n.locator('[data-onclick="k39"]').click();
    const when = [[D1, '08:00'], [D1, '20:00'], [D2, '08:00'], [D2, '20:00']];
    for (let i = 1; i <= when.length; i++) {
      await n.locator('[data-onclick="k43"]').click();
      await typeInto(n, `#b-dose-mg-${i}`, '1000'); await typeInto(n, `#b-dose-tinf-${i}`, '1');
      await n.locator(`#b-dose-date-${i}`).fill(when[i - 1][0]); await typeInto(n, `#b-dose-time-${i}`, when[i - 1][1]);
    }
    await n.locator('[data-onclick="k46"]').click();
    await typeInto(n, '#b-lvl-conc-1', '19.9'); await n.locator('#b-lvl-date-1').fill(day(0)); await typeInto(n, '#b-lvl-time-1', '07:30');
    await n.locator('[data-onclick="k47"]').click(); await n.waitForSelector('#b-results .rec-dose', { timeout: 20000 }); await n.waitForTimeout(300);
    const nl = await n.evaluate(() => {
      const t = (s) => (document.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim();
      return { all: t('#b-results'), next: t('#b-results .vx-next'), conf: t('#b-results .vx-conf'), act: t('#b-results .vx-action'),
        fit: t('#ev-fit'), models: t('#ev-models') };
    });
    const printedN = await n.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return (document.getElementById('print-report') || {}).textContent.replace(/\s+/g, ' '); });
    // incoherent(): the file-level coherence predicate (D26 review; Task 6b, Task 9 and the final review).
    ok('D26: the 76 M on Buelga never says both "would add little" and "is recommended", on screen or in print',
       !incoherent(nl.all) && !incoherent(printedN)
       && /^Next A further level is recommended\.$/.test(nl.next),
       JSON.stringify({ next: nl.next, little: /would add little/.test(nl.all), rec: (nl.all.match(/[^.]*is recommended[^.]*\./g) || []) }));
    ok('D26: Low confidence names the model disagreement with both AUCs; "does not trust" is gone; Fit and Models point to Next',
       /^Low confidence — The applicable models disagree by \d+% on exposure \(AUC₂₄ \d+ on Buelga 1-comp and \d+ on Goti 2-comp\)/.test(nl.conf)
       && !/does not trust/.test(nl.all + printedN) && /the Next line/.test(nl.fit) && /the Next line/.test(nl.models)
       && !/further concentration is recommended|next step above says|level panel further down/.test(nl.all),
       JSON.stringify({ act: nl.act, conf: nl.conf.slice(0, 220), fitPtr: /the Next line/.test(nl.fit), modelsPtr: /the Next line/.test(nl.models) }));
    // The Task 6 review: a cap-bound continue inside the rounding grace (AUC24 just under 400) fell to
    // "would add little" beside the cap-bound alarm. A fictional 25 M (70 kg, 180 cm, SCr 0.5) on
    // Buelga, 1.5 g q8h x 6 over 1.5 h, the last at 02:30 today; levels 25 mg/L at 04:30 and 5 mg/L now.
    await n.goto(BASE + '?v=nlv2-' + Date.now(), { waitUntil: 'networkidle' });
    await n.locator('[data-onclick="k2"]').click();
    await typeInto(n, '#b-age', '25'); await typeInto(n, '#b-tbw', '70'); await typeInto(n, '#b-height', '180'); await typeInto(n, '#b-scr', '0.5');
    await n.locator('[data-onclick="k39"]').click();
    const capWhen = [[D1, '10:30'], [D1, '18:30'], [D2, '02:30'], [D2, '10:30'], [D2, '18:30'], [day(0), '02:30']];
    for (let i = 1; i <= capWhen.length; i++) {
      await n.locator('[data-onclick="k43"]').click();
      await typeInto(n, `#b-dose-mg-${i}`, '1500'); await typeInto(n, `#b-dose-tinf-${i}`, '1.5');
      await n.locator(`#b-dose-date-${i}`).fill(capWhen[i - 1][0]); await typeInto(n, `#b-dose-time-${i}`, capWhen[i - 1][1]);
    }
    for (const [i, conc, t] of [[1, '25', '04:30'], [2, '5', '10:00']]) {
      await n.locator('[data-onclick="k46"]').click();
      await typeInto(n, `#b-lvl-conc-${i}`, conc); await n.locator(`#b-lvl-date-${i}`).fill(day(0)); await typeInto(n, `#b-lvl-time-${i}`, t);
    }
    await n.locator('[data-onclick="k47"]').click(); await n.waitForSelector('#b-results .rec-dose', { timeout: 20000 }); await n.waitForTimeout(300);
    const cg = await n.evaluate(() => {
      const t = (s) => (document.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim();
      return { all: t('#b-results'), next: t('#b-results .vx-next'), act: t('#b-results .vx-action'), reg: t('#vx-regimen'), conf: t('#b-results .vx-conf').slice(0, 40) };
    });
    const printedC = await n.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return (document.getElementById('print-report') || {}).textContent.replace(/\s+/g, ' '); });
    ok('D26 review: a cap-bound continue just under 400 asks to confirm the clearance with a level, never "would add little", on screen or in print',
       cg.act === 'Continue the current regimen' && cg.reg === '1.5 g IV q8h' && /cannot be reached within the conventional ceilings/.test(cg.all)
       && /^Next Confirm the clearance with a level\.$/.test(cg.next) && !incoherent(cg.all) && !incoherent(printedC),
       JSON.stringify({ act: cg.act, reg: cg.reg, conf: cg.conf, next: cg.next, little: /would add little/.test(cg.all) }));
    // Task 6b (R12): at high clearance every admissible regimen has 0 of 20 in range, and "no better"
    // continued 1 g q12h at AUC24 133 beside 1.5 g q8h at 299. A fictional 22 M (95 kg, 190 cm,
    // SCr 0.4) on Buelga, 1 g q12h x 4 over 1 h, the last at 23:30 yesterday; levels 4, 1 and
    // 0.3 mg/L at 01:30, 05:30 and 09:30 today.
    await n.goto(BASE + '?v=nlv3-' + Date.now(), { waitUntil: 'networkidle' });
    await n.locator('[data-onclick="k2"]').click();
    await typeInto(n, '#b-age', '22'); await typeInto(n, '#b-tbw', '95'); await typeInto(n, '#b-height', '190'); await typeInto(n, '#b-scr', '0.4');
    await n.locator('[data-onclick="k39"]').click();
    const lowWhen = [[D1, '11:30'], [D1, '23:30'], [D2, '11:30'], [D2, '23:30']];
    for (let i = 1; i <= lowWhen.length; i++) {
      await n.locator('[data-onclick="k43"]').click();
      await typeInto(n, `#b-dose-mg-${i}`, '1000'); await typeInto(n, `#b-dose-tinf-${i}`, '1');
      await n.locator(`#b-dose-date-${i}`).fill(lowWhen[i - 1][0]); await typeInto(n, `#b-dose-time-${i}`, lowWhen[i - 1][1]);
    }
    for (const [i, conc, t] of [[1, '4', '01:30'], [2, '1', '05:30'], [3, '0.3', '09:30']]) {
      await n.locator('[data-onclick="k46"]').click();
      await typeInto(n, `#b-lvl-conc-${i}`, conc); await n.locator(`#b-lvl-date-${i}`).fill(day(0)); await typeInto(n, `#b-lvl-time-${i}`, t);
    }
    await n.locator('[data-onclick="k47"]').click(); await n.waitForSelector('#b-results .rec-dose', { timeout: 20000 }); await n.waitForTimeout(300);
    const lo = await n.evaluate(() => {
      const t = (s) => (document.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim();
      return { all: t('#b-results'), act: t('#b-results .vx-action'), reg: t('#vx-regimen'), why: t('#b-results .vx-why'),
        next: t('#b-results .vx-next'), conf: t('#b-results .vx-conf').slice(0, 40), said: t('#sr-announce') };
    });
    const printedL = await n.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return (document.getElementById('print-report') || {}).textContent.replace(/\s+/g, ' '); });
    ok('D26: a 0-of-20 regimen at high clearance is changed, not continued',
       lo.act === 'Change from 1 g IV q12h' && lo.reg === '1.5 g IV q8h' && /^High confidence/.test(lo.conf)
       && /^The current regimen gives AUC₂₄ 133 with 0 of 20 plausible AUCs in 400–600, and no admissible regimen puts more in range; this one brings AUC₂₄ nearer the band, to 299, with 0 of 20 in range\./.test(lo.why)
       && /cannot be reached within the conventional ceilings/.test(lo.all)
       && !/Continue the current regimen/.test(lo.all + printedL) && /Change from 1 g IV q12h/.test(printedL)
       && !/^Result: continue/.test(lo.said) && /^Next Confirm the clearance with a level\.$/.test(lo.next)
       && !incoherent(lo.all) && !incoherent(printedL),
       JSON.stringify({ act: lo.act, reg: lo.reg, conf: lo.conf, why: lo.why, next: lo.next, said: lo.said.slice(0, 80) }));
    // Task 9, the user's ruling 3 (UI report I8): a Low-confidence fit moved an in-range regimen for two
    // more of 20 plausible AUCs. A fictional 30 M (125 kg, 170 cm, BMI 43.3, SCr 0.9) on Hughes, 1.5 g
    // q12h x 4 over 2 h, the last at 22:30 yesterday; one level of 14 mg/L now. The models disagree,
    // so the rating is Low; the dots alone would move to 1.25 g q12h (15 of 20 against 13). A real fit.
    await n.goto(BASE + '?v=nlv4-' + Date.now(), { waitUntil: 'networkidle' });
    await n.locator('[data-onclick="k2"]').click();
    await typeInto(n, '#b-age', '30'); await typeInto(n, '#b-tbw', '125'); await typeInto(n, '#b-height', '170'); await typeInto(n, '#b-scr', '0.9');
    await n.locator('[data-onclick="k39"]').click();
    await n.locator('#b-model-btn-hughes').click();
    const lcWhen = [[D1, '10:30'], [D1, '22:30'], [D2, '10:30'], [D2, '22:30']];
    for (let i = 1; i <= lcWhen.length; i++) {
      await n.locator('[data-onclick="k43"]').click();
      await typeInto(n, `#b-dose-mg-${i}`, '1500'); await typeInto(n, `#b-dose-tinf-${i}`, '2');
      await n.locator(`#b-dose-date-${i}`).fill(lcWhen[i - 1][0]); await typeInto(n, `#b-dose-time-${i}`, lcWhen[i - 1][1]);
    }
    await n.locator('[data-onclick="k46"]').click();
    await typeInto(n, '#b-lvl-conc-1', '14'); await n.locator('#b-lvl-date-1').fill(day(0)); await typeInto(n, '#b-lvl-time-1', '10:00');
    await n.locator('[data-onclick="k47"]').click(); await n.waitForSelector('#b-results .rec-dose', { timeout: 20000 }); await n.waitForTimeout(300);
    const lc = await n.evaluate(() => {
      const t = (s) => (document.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim();
      return { model: bState.result && bState.result.model, all: t('#b-results'), act: t('#b-results .vx-action'), reg: t('#vx-regimen'), why: t('#b-results .vx-why'),
        next: t('#b-results .vx-next'), conf: t('#b-results .vx-conf'), delta: !!document.querySelector('#b-results .vx-delta'),
        first: t('#b-first-readout'), firstK: t('#b-results .vx-first .vx-k'), said: t('#sr-announce'), summary: String(bState.summaryText || ''),
        alt: bState.result && bState.result.rec.lowConfidenceAlt ? fmtRegimen(bState.result.rec.lowConfidenceAlt.dose, bState.result.rec.lowConfidenceAlt.tau) : '' };
    });
    const printedLC = await n.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return (document.getElementById('print-report') || {}).textContent.replace(/\s+/g, ' '); });
    ok('D26: Low confidence keeps an in-range regimen and asks for a level',
       lc.model === 'hughes' && lc.act === 'Continue the current regimen' && lc.reg === '1.5 g IV q12h' && !lc.delta
       && /^Low confidence — The applicable models disagree by \d+% on exposure/.test(lc.conf)
       // Task 9 review: the regimen set aside is named (lowConfidenceAlt), the cause alone, no nested
       // parentheses, and no target-box sentence after it.
       && lc.alt === '1.25 g IV q12h'
       && /^Within 400–600 at AUC₂₄ \d+ with 13 of 20 plausible AUCs in range\. 1\.25 g IV q12h would put 15 of 20 plausible AUCs in range, but confidence in this fit is Low \(the models disagree by \d+%\), so the regimen is not changed on it\. Draw a level\.$/.test(lc.why)
       && lc.why.indexOf(`${lc.alt} would put`) > 0 && !/\([^)]*\(/.test(lc.why) && !/Your target of/.test(lc.why)
       && /^Next A further level is recommended\.$/.test(lc.next) && lc.firstK === 'Next dose'
       && /^Result: continue 1\.5 g IV q12h, AUC24 \d+, Low confidence\./.test(lc.said) && /Continuing 1\.5 g IV q12h is predicted to give/.test(lc.summary)
       && /Continue the current regimen\s*1\.5 g IV q12h/.test(printedLC) && /so the regimen is not changed on it\. Draw a level\./.test(printedLC)
       && !/Change from 1\.5 g/.test(lc.all + printedLC) && !incoherent(lc.all) && !incoherent(printedLC),
       JSON.stringify({ model: lc.model, act: lc.act, reg: lc.reg, conf: lc.conf.slice(0, 60), why: lc.why, next: lc.next, firstK: lc.firstK, said: lc.said, summary: lc.summary.slice(0, 120) }));
    const nAttr = await attributeInjected(n, nProblems);
    results.cloudflareInjected = (results.cloudflareInjected || 0) + nAttr.injected;
    results.problems.push(...nAttr.kept);
    await nctx.close();
  }

  // v3.14.0 (D26), engine report C1: a supratherapeutic patient was given a time for the next
  // dose with no hold. The user's ruling: a fitted pre-dose level of 20 mg/L or more is a Hold.
  // A fictional 60 M (80 kg, 178 cm, SCr 3.0) on Buelga, 1.5 g q8h x 6 over 2 h, the last
  // dose 6 h ago and a 48 mg/L level 1 h ago. Then the Trough module, a steady-state level of
  // 45 mg/L on 1.5 g q8h. Fixed clock: today 10:00.
  {
    const hctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const h = await hctx.newPage();
    const hProblems = watch(h, 'hold');
    await h.clock.setFixedTime(new Date(`${day(0)}T10:00`));
    await h.goto(BASE + '?v=pwh-' + Date.now(), { waitUntil: 'networkidle' });
    await h.locator('[data-onclick="k2"]').click();
    await typeInto(h, '#b-age', '60'); await typeInto(h, '#b-tbw', '80'); await typeInto(h, '#b-height', '178'); await typeInto(h, '#b-scr', '3.0');
    await h.locator('[data-onclick="k39"]').click();
    const times = [[day(-2), '12:00'], [day(-2), '20:00'], [day(-1), '04:00'], [day(-1), '12:00'], [day(-1), '20:00'], [day(0), '04:00']];
    for (let n = 1; n <= times.length; n++) {
      await h.locator('[data-onclick="k43"]').click();
      await typeInto(h, `#b-dose-mg-${n}`, '1500'); await typeInto(h, `#b-dose-tinf-${n}`, '2');
      await h.locator(`#b-dose-date-${n}`).fill(times[n - 1][0]); await typeInto(h, `#b-dose-time-${n}`, times[n - 1][1]);
    }
    await h.locator('[data-onclick="k46"]').click();
    await typeInto(h, '#b-lvl-conc-1', '48'); await h.locator('#b-lvl-date-1').fill(day(0)); await typeInto(h, '#b-lvl-time-1', '09:00');
    await h.locator('[data-onclick="k47"]').click(); await h.waitForSelector('#b-results .rec-dose', { timeout: 20000 }); await h.waitForTimeout(300);
    const held = await h.evaluate(() => {
      const v = document.querySelector('#b-results .vx-verdict'), a = v && v.querySelector('.vx-action'), reg = document.getElementById('vx-regimen');
      const lvl = document.querySelector('#b-first-readout strong');
      return { first: v ? v.innerText.trim().split('\n')[0].trim() : '',
        act: a ? a.textContent.replace(/\s+/g, ' ').trim() : '', icon: !!(a && a.querySelector('svg.ic')), alarm: !!(a && a.classList.contains('tone-alarm')),
        before: !!(a && reg && (a.compareDocumentPosition(reg) & Node.DOCUMENT_POSITION_FOLLOWING)),
        reg: reg ? reg.textContent.replace(/\s+/g, ' ').trim() : '',
        readout: (document.getElementById('b-first-readout') || {}).textContent || '',
        lvlCls: lvl ? lvl.className : '', said: (document.getElementById('sr-announce') || {}).textContent || '',
        summary: (bState && bState.summaryText) || '' };
    });
    const whenM = held.first.match(/^Hold: next dose not before (\d{1,2} [A-Z][a-z]{2} \d\d:\d\d)$/);
    ok('D26: a 48 mg/L level gives Hold — the verdict\'s first line, the alarm word and icon, before the regimen to resume with',
       !!whenM && held.act === held.first && held.icon && held.alarm && held.before && /IV q\d+h/.test(held.reg), JSON.stringify(held));
    ok('D26: the first dose is not before the hold\'s time, and the level by then is in the alarm tone',
       !!whenM && held.readout.indexOf(whenM[1]) >= 0 && /Hold/.test(held.readout) && held.lvlCls === 'tone-alarm', JSON.stringify(held));
    ok('D26: the screen reader and the copy summary hear the hold', /^Result: Hold: next dose not before /.test(held.said) && /^Hold: next dose not before /.test(held.summary),
       JSON.stringify({ said: held.said, summary: held.summary }));
    const printedH = await h.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return (document.getElementById('print-report') || {}).textContent.replace(/\s+/g, ' '); });
    ok('D26: the printed report says Hold', /Hold: next dose not before \d{1,2} [A-Z][a-z]{2} \d\d:\d\d/.test(printedH),
       printedH.slice(printedH.indexOf('Dose recommendation'), printedH.indexOf('Dose recommendation') + 600));

    // Task 2 review: with "Project next doses" ticked under a hold, the projection is drawn
    // (from the resume time; SUITE 44.5d checks the start) and its note and key are shown.
    await h.locator('#b-proj-fwd').check(); await h.waitForTimeout(400);
    const projH = await h.evaluate(() => ({ note: (document.getElementById('b-proj-auc-note') || {}).textContent || '',
      key: (document.getElementById('b-proj-legend') || {}).style.display }));
    ok('D26: under a hold the projection is drawn with its note and key', /^Projected AUC₂₄ \d+ mg·h\/L$/.test(projH.note) && projH.key === '', JSON.stringify(projH));

    // The Trough module, steady-state level mode: the same hold, timed from the fitted decline.
    await h.locator('[data-onclick="k1"]').click();
    await typeInto(h, '#age', '60'); await typeInto(h, '#tbw', '80'); await typeInto(h, '#height', '178'); await typeInto(h, '#scr', '1.0');
    await h.locator('[data-onclick="k9"]').first().click();
    await h.locator('#mode-btn-level').click();
    await typeInto(h, '#dose', '1500');
    await h.locator('#interval').selectOption('8');
    await typeInto(h, '#tinf', '1.5');
    await h.evaluate(() => { const x = document.getElementById('has-level'); if (x && !x.checked) x.click(); });
    await typeInto(h, '#level-val', '45');
    await h.locator('#time-dose-given-date').fill(day(0)); await typeInto(h, '#time-dose-given-time', '0100');
    await h.locator('#time-level-drawn-date').fill(day(0)); await typeInto(h, '#time-level-drawn-time', '0845');
    await h.locator('[data-onclick="k31"]').click(); await h.waitForTimeout(600);
    const tHold = await h.evaluate(() => {
      const v = document.querySelector('#results-content .tx-verdict'), a = v && v.querySelector('.vx-action'), reg = document.getElementById('tx-regimen');
      return { act: a ? a.textContent.replace(/\s+/g, ' ').trim() : '', icon: !!(a && a.querySelector('svg.ic')), alarm: !!(a && a.classList.contains('tone-alarm')),
        before: !!(a && reg && (a.compareDocumentPosition(reg) & Node.DOCUMENT_POSITION_FOLLOWING)),
        said: (document.getElementById('sr-announce') || {}).textContent || '' };
    });
    ok('D26: Trough level mode holds — a 45 mg/L steady-state level on 1.5 g q8h shows Hold and a re-dose time',
       /^Hold: next dose not before \d{1,2} [A-Z][a-z]{2} \d\d:\d\d$/.test(tHold.act) && tHold.icon && tHold.alarm && tHold.before && /^Result: Hold: /.test(tHold.said),
       JSON.stringify(tHold));
    const hAttr = await attributeInjected(h, hProblems);
    results.cloudflareInjected = (results.cloudflareInjected || 0) + hAttr.injected;
    results.problems.push(...hAttr.kept);
    await hctx.close();
  }

  // v3.14.0 (D26), the final whole-branch review (rulings R25, R26). Review Focus 1: an anuric patient
  // with flat levels was told "Hold: next dose not before …" beside "Next: A further level would add
  // little" (C1). Then a newer measured level the fit reads lower (I1), the refusal's hold (I2), and the
  // Trough random-level hold (I4) and level-mode due time (I3). Fictional patients; fixed clock today 10:00.
  {
    const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const a = await actx.newPage();
    const aProblems = watch(a, 'final-review');
    await a.clock.setFixedTime(new Date(`${day(0)}T10:00`));
    const aucRun = async (tag, pt, doses, levels, waitSel) => {
      await a.goto(BASE + `?v=${tag}-` + Date.now(), { waitUntil: 'networkidle' });
      await a.locator('[data-onclick="k2"]').click();
      await typeInto(a, '#b-age', pt.age); await typeInto(a, '#b-tbw', pt.tbw); await typeInto(a, '#b-height', pt.ht); await typeInto(a, '#b-scr', pt.scr);
      await a.locator('[data-onclick="k39"]').click();
      await a.locator('#b-model-btn-goti').click();
      for (let i = 1; i <= doses.length; i++) {
        await a.locator('[data-onclick="k43"]').click();
        await typeInto(a, `#b-dose-mg-${i}`, doses[i - 1][0]); await typeInto(a, `#b-dose-tinf-${i}`, doses[i - 1][1]);
        await a.locator(`#b-dose-date-${i}`).fill(doses[i - 1][2]); await typeInto(a, `#b-dose-time-${i}`, doses[i - 1][3]);
      }
      for (let i = 1; i <= levels.length; i++) {
        await a.locator('[data-onclick="k46"]').click();
        await typeInto(a, `#b-lvl-conc-${i}`, levels[i - 1][0]); await a.locator(`#b-lvl-date-${i}`).fill(levels[i - 1][1]); await typeInto(a, `#b-lvl-time-${i}`, levels[i - 1][2]);
      }
      await a.locator('[data-onclick="k47"]').click(); await a.waitForSelector(waitSel || '#b-results .rec-dose', { timeout: 20000 }); await a.waitForTimeout(300);
      return a.evaluate(() => {
        const t = (s) => (document.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim();
        const head = document.querySelector('#b-results .vx-hold-head'), reg = document.getElementById('vx-regimen');
        return { all: t('#b-results'), head: head ? head.textContent.replace(/\s+/g, ' ').trim() : '', headCls: head ? head.className : '',
          icon: !!(head && head.querySelector('svg.ic')), before: !!(head && reg && (head.compareDocumentPosition(reg) & Node.DOCUMENT_POSITION_FOLLOWING)),
          next: t('#b-results .vx-next'), reg: reg ? reg.textContent.replace(/\s+/g, ' ').trim() : '', voi: t('#b-voi'),
          said: t('#sr-announce'), summary: String(bState.summaryText || '') };
      });
    };
    const printed = () => a.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return (document.getElementById('print-report') || {}).textContent.replace(/\s+/g, ' '); });
    // C1: 70 M, 70 kg, 175 cm, SCr 8.5 (CrCl 8), Goti; one 2 g dose over 2 h, 100 h ago; levels 52, 51 and 50.2 mg/L.
    const c1 = await aucRun('c1', { age: '70', tbw: '70', ht: '175', scr: '8.5' }, [['2000', '2', day(-4), '06:00']],
      [['52', day(-3), '10:00'], ['51', day(-2), '10:00'], ['50.2', day(0), '09:00']]);
    const c1p = await printed();
    // Wave 2 (the user's ruling U2, 72 h): this flat-levels patient has no resume time within the horizon.
    ok('D26: final review (Review Focus 1): the anuric flat-levels patient — "Hold: recheck a level before the next dose" leads, and Next says it, never "would add little", on screen and in print',
       c1.head === 'Hold: recheck a level before the next dose' && c1.icon && c1.before && c1.next === 'Next Recheck a level before the next dose.'
       && !/would add little/.test(c1.all + c1p) && !incoherent(c1.all) && !incoherent(c1p) && /Recheck a level before the next dose/.test(c1.voi)
       && !/not before/.test(c1.head + c1.summary + c1.said)
       // Wave 2 label fix: the readout's 49.9 is the carried measured level, never called "fitted level", on screen or in print.
       && !/fitted level 49\.9/i.test(c1.all + c1p) && /measured level, carried down the fitted slope, 49\.9 mg\/L/i.test(c1.all) && /Measured level, carried down the fitted slope, 49\.9 mg\/L/.test(c1p),
       JSON.stringify({ head: c1.head, next: c1.next, voi: c1.voi.slice(0, 80), little: /would add little/.test(c1.all + c1p) }));
    ok('D26: final review: the copy summary and the announcement carry the hold, with no clock time',
       /^Hold: recheck a level before the next dose/.test(c1.summary) && /^Result: Hold: recheck a level before the next dose/.test(c1.said)
       && !/\d\d:\d\d/.test(c1.summary.split('. ')[0]), JSON.stringify({ summary: c1.summary, said: c1.said }));
    ok('D26: final review (I5): beside the Hold the severe-renal note says no further dose until a level, with no loading-dose sentence and no clamp that did not happen',
       /No further dose until a level is drawn/.test(c1.all) && !/Give a single weight-based loading dose/.test(c1.all) && !/not the actual 8\b/.test(c1.all),
       c1.all.slice(c1.all.indexOf('Severe renal'), c1.all.indexOf('Severe renal') + 300));
    // U1 (the user's ruling; was I1): 70 M, 80 kg, 185 cm, SCr 9.7 (CrCl 8), Goti; one 1.5 g dose 120 h ago; levels
    // 35, 30.3 and 26.2 mg/L, the last at 09:00. The measured 26.2, carried down the fitted slope, holds the dose.
    const i1 = await aucRun('i1', { age: '70', tbw: '80', ht: '185', scr: '9.7' }, [['1500', '2', day(-5), '10:00']],
      [['35', day(-3), '09:00'], ['30.3', day(-2), '09:00'], ['26.2', day(0), '09:00']]);
    const i1p = await printed();
    const i1why = await a.evaluate(() => ((document.querySelector('#b-results .vx-hold-why') || {}).textContent || '').replace(/\s+/g, ' ').trim());
    ok('D26: final review (U1): a measured 26.2 mg/L the fit reads lower holds the dose, with a resume time; the hold line names the measured basis; Next, summary, announcement and print say it',
       /^Hold: next dose not before \d{1,2} [A-Z][a-z]{2} \d\d:\d\d$/.test(i1.head) && i1.icon && i1.before && /tone-alarm/.test(i1.headCls)
       && /^The measured 26\.2 mg\/L at \d{1,2} [A-Z][a-z]{2} 09:00, carried down the fitted slope, is [\d.]+ mg\/L at /.test(i1why)
       && !/the fit reads it lower|vx-measured-high/.test(i1.all + i1.headCls) && i1.next === 'Next Recheck a level before the next dose.'
       && /^Hold: next dose not before /.test(i1.summary) && /carried down the fitted slope/.test(i1.summary) && /^Result: Hold: next dose not before /.test(i1.said)
       && /Hold: next dose not before/.test(i1p) && !incoherent(i1.all) && !incoherent(i1p),
       JSON.stringify({ head: i1.head, why: i1why.slice(0, 160), next: i1.next, said: i1.said.slice(0, 80) }));
    // k82: a first-dose time past the resume time clears the hold, and the Next line, panel and summary follow it; a time inside it holds again.
    const firstAt = async (d, t) => {
      const open = await a.evaluate(() => document.querySelector('#b-results [data-onclick="k83"]').getAttribute('aria-expanded'));
      if (open !== 'true') { await a.locator('#b-results [data-onclick="k83"]').click(); await a.waitForTimeout(150); }
      { const [yy, mm, dd] = d.split('-'); await a.locator('#b-first-date').focus(); await a.keyboard.type(mm + dd + yy); await a.waitForTimeout(200); }
      await typeInto(a, '#b-first-time', t); await a.locator('#b-first-time').press('Tab'); await a.waitForTimeout(400);
      return a.evaluate(() => ({ hold: ((document.getElementById('b-hold') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        next: ((document.querySelector('#b-results .vx-next') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        voi: ((document.getElementById('b-voi') || {}).textContent || '').replace(/\s+/g, ' ').trim(), summary: String(bState.summaryText || '') }));
    };
    const late = await firstAt(day(5), '1200');
    const inside = await firstAt(day(1), '1200');
    ok('D26: final review: a chosen time past the hold clears it and the Next line, panel and summary follow; a time inside it holds again',
       late.hold === '' && !/Recheck a level/.test(late.next + late.voi + late.summary) && /^Next /.test(late.next) && !/Hold: /.test(late.summary)
       && /^Hold: next dose not before/.test(inside.hold) && inside.next === 'Next Recheck a level before the next dose.' && /Recheck a level/.test(inside.voi)
       && /^Hold: next dose not before/.test(inside.summary),
       JSON.stringify({ late: { hold: late.hold.slice(0, 70), next: late.next, summary: late.summary.slice(0, 40) }, inside: { hold: inside.hold.slice(0, 60), next: inside.next } }));
    // U1: a routine peak never holds. The re-reviewer's case: 60 M, 80 kg, 178 cm, SCr 1.0, Buelga; 1.25 g q12h x 4 over
    // 1.5 h, the last at 07:30; a trough of 15 mg/L at 07:00 and a peak of 35 mg/L at 10:00, 1 h after the infusion ended.
    await a.goto(BASE + '?v=peak-' + Date.now(), { waitUntil: 'networkidle' });
    await a.locator('[data-onclick="k2"]').click();
    await typeInto(a, '#b-age', '60'); await typeInto(a, '#b-tbw', '80'); await typeInto(a, '#b-height', '178'); await typeInto(a, '#b-scr', '1.0');
    await a.locator('[data-onclick="k39"]').click();
    const pkWhen = [[day(-2), '19:30'], [day(-1), '07:30'], [day(-1), '19:30'], [day(0), '07:30']];
    for (let i = 1; i <= pkWhen.length; i++) {
      await a.locator('[data-onclick="k43"]').click();
      await typeInto(a, `#b-dose-mg-${i}`, '1250'); await typeInto(a, `#b-dose-tinf-${i}`, '1.5');
      await a.locator(`#b-dose-date-${i}`).fill(pkWhen[i - 1][0]); await typeInto(a, `#b-dose-time-${i}`, pkWhen[i - 1][1]);
    }
    for (const [i, conc, t] of [[1, '15', '07:00'], [2, '35', '10:00']]) {
      await a.locator('[data-onclick="k46"]').click();
      await typeInto(a, `#b-lvl-conc-${i}`, conc); await a.locator(`#b-lvl-date-${i}`).fill(day(0)); await typeInto(a, `#b-lvl-time-${i}`, t);
    }
    await a.locator('[data-onclick="k47"]').click(); await a.waitForSelector('#b-results .rec-dose', { timeout: 20000 }); await a.waitForTimeout(300);
    const pk = await a.evaluate(() => ({ all: (document.getElementById('b-results') || {}).textContent.replace(/\s+/g, ' '), said: (document.getElementById('sr-announce') || {}).textContent || '',
      head: !!document.querySelector('#b-results .vx-hold-head'), summary: String(bState.summaryText || '') }));
    ok('D26: final review (U1): a routine peak (35 mg/L an hour after the infusion, trough 15) neither holds nor raises an alarm',
       !pk.head && !/Hold: /.test(pk.all + pk.said + pk.summary) && !/Measured 35/.test(pk.all), JSON.stringify({ head: pk.head, said: pk.said.slice(0, 120) }));
    // I2: the same patient as C1 with one 1.75 g dose: every candidate hard-fails.
    const i2 = await aucRun('i2', { age: '70', tbw: '70', ht: '175', scr: '8.5' }, [['1750', '2', day(-4), '06:00']],
      [['52', day(-3), '08:00'], ['51', day(-2), '08:00'], ['50.2', day(0), '08:00']], '#vx-regimen');
    const i2p = await printed();
    ok('D26: final review (I2): a refusal with levels at or above 20 mg/L leads with "Hold: recheck a level before the next dose", on screen, in the summary, aloud and in print',
       i2.reg === 'No regimen recommended' && i2.head === 'Hold: recheck a level before the next dose' && i2.icon && i2.before
       && /^Hold: recheck a level before the next dose/.test(i2.summary) && /^Result: Hold: recheck a level before the next dose/.test(i2.said)
       && /Hold: recheck a level before the next dose/.test(i2p) && /^Next Recheck a level before the next dose\./.test(i2.next),
       JSON.stringify({ reg: i2.reg, head: i2.head, next: i2.next, said: i2.said.slice(0, 90) }));
    // I4 and I3, the Trough module: 60 M, 80 kg, 178 cm, SCr 1.0.
    await a.locator('[data-onclick="k1"]').click();
    await typeInto(a, '#age', '60'); await typeInto(a, '#tbw', '80'); await typeInto(a, '#height', '178'); await typeInto(a, '#scr', '1.0');
    await a.locator('[data-onclick="k9"]').first().click();
    const txState = () => a.evaluate(() => {
      const v = document.querySelector('#results-content .tx-verdict'), h = v && v.querySelector('.vx-hold-head'), reg = document.getElementById('tx-regimen');
      return { head: h ? h.textContent.replace(/\s+/g, ' ').trim() : '', alarm: !!(h && h.classList.contains('tone-alarm')), icon: !!(h && h.querySelector('svg.ic')),
        before: !!(h && reg && (h.compareDocumentPosition(reg) & Node.DOCUMENT_POSITION_FOLLOWING)), reg: reg ? reg.textContent.replace(/\s+/g, ' ').trim() : '',
        said: (document.getElementById('sr-announce') || {}).textContent || '' };
    });
    // Random level at steady state on q12h: 42 mg/L 9 h after a 1 g dose (about 38 at the due time).
    await a.locator('#mode-btn-randomlevel').click();
    await a.locator('[data-onclick="k28"]').first().click();
    const rlSS = await a.evaluate(() => typeof state !== 'undefined' && state.rlMode);
    await typeInto(a, '#rl-dose', '1000'); await typeInto(a, '#rl-tinf', '1'); await typeInto(a, '#rl-c', '42');
    await a.locator('#rl-dose-time-date').fill(day(0)); await typeInto(a, '#rl-dose-time-time', '0000');
    await a.locator('#rl-draw-time-date').fill(day(0)); await typeInto(a, '#rl-draw-time-time', '0900');
    await a.locator('#rl-tau').selectOption('24');
    await a.locator('#rl-interval').selectOption('12');
    await a.locator('[data-onclick="k31"]').click(); await a.waitForTimeout(500);
    const rl = await txState();
    ok('D26: final review (I4): Trough random level holds — 42 mg/L at 9 h on q12h at steady state shows Hold, the alarm word and icon, before the regimen, and is heard first',
       rlSS === 'steadystate' && /^Hold: next dose not before \d{1,2} [A-Z][a-z]{2} \d\d:\d\d$/.test(rl.head) && rl.alarm && rl.icon && rl.before && /^Result: Hold: /.test(rl.said),
       JSON.stringify(Object.assign({ rlMode: rlSS }, rl)));
    // Level mode: 1.5 g q8h started 01:00, 20.5 mg/L at 08:36 — below 20 before the 09:00 due time: no hold.
    await a.locator('#mode-btn-level').click();
    await typeInto(a, '#dose', '1500'); await a.locator('#interval').selectOption('8'); await typeInto(a, '#tinf', '1.5');
    await a.evaluate(() => { const x = document.getElementById('has-level'); if (x && !x.checked) x.click(); });
    await typeInto(a, '#level-val', '20.5');
    await a.locator('#time-dose-given-date').fill(day(0)); await typeInto(a, '#time-dose-given-time', '0100');
    await a.locator('#time-level-drawn-date').fill(day(0)); await typeInto(a, '#time-level-drawn-time', '0836');
    await a.locator('[data-onclick="k31"]').click(); await a.waitForTimeout(600);
    const lv = await txState();
    ok('D26: final review (I3): Trough level mode does not hold a level that falls below 20 mg/L before the due time (20.5 mg/L at 08:36 on q8h from 01:00)',
       lv.head === '' && !/^Result: Hold/.test(lv.said) && !!lv.reg, JSON.stringify(lv));
    const aAttr = await attributeInjected(a, aProblems);
    results.cloudflareInjected = (results.cloudflareInjected || 0) + aAttr.injected;
    results.problems.push(...aAttr.kept);
    await actx.close();
  }

  // v3.14.0 (D26), engine report C2 and I1; the user's ruling 2: the Trough module obeys AUC
  // Precision's ceilings (2 g a dose, 4.5 g a day, AUC24 700) and gives no empiric maintenance
  // regimen at CrCl under 10 without a level. Fictional patients: 25 M, 95 kg, 185 cm, SCr 0.5
  // (CrCl 303.5) at q8h, which was told 7.5 g a day; and 85 F, 45 kg, 155 cm, SCr 4.5 (CrCl 6.5).
  {
    const cctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const c = await cctx.newPage();
    const cProblems = watch(c, 'ceilings');
    await c.goto(BASE + '?v=pwc-' + Date.now(), { waitUntil: 'networkidle' });
    await c.locator('[data-onclick="k1"]').click();
    const verdictOf = () => c.evaluate(() => {
      const v = document.querySelector('#results-content .tx-verdict'), reg = document.getElementById('tx-regimen');
      const notes = [...document.querySelectorAll('#results-content .note')].map(n => ({ cls: n.className, word: (n.querySelector('.note-word') || {}).textContent || '', text: n.textContent.replace(/\s+/g, ' ') }));
      return { reg: reg ? reg.textContent.replace(/\s+/g, ' ').trim() : '', hold: !!(reg && reg.classList.contains('vx-regimen-hold')),
        dose: !!(v && v.querySelector('.rec-dose')), why: ((v && v.querySelector('.vx-hold')) || {}).textContent || '', notes,
        said: (document.getElementById('sr-announce') || {}).textContent || '' };
    });
    await typeInto(c, '#age', '25'); await typeInto(c, '#tbw', '95'); await typeInto(c, '#height', '185'); await typeInto(c, '#scr', '0.5');
    await c.locator('[data-onclick="k9"]').first().click();
    await c.locator('#init-interval').selectOption('8');
    await c.locator('[data-onclick="k31"]').click(); await c.waitForTimeout(500);
    const arc = await verdictOf();
    const capNote = arc.notes.find(n => /note-alarm/.test(n.cls) && /The target cannot be reached within the conventional ceilings/.test(n.text));
    ok('D26: Trough refuses 7.5 g a day — "No regimen recommended", no dose, the cap-bound alarm',
       arc.reg === 'No regimen recommended' && arc.hold && !arc.dose && !!capNote && /q8h/.test(arc.why) && /^Result: No regimen recommended/.test(arc.said), JSON.stringify(arc).slice(0, 600));
    ok('D26: Trough shows the augmented-clearance caution', arc.notes.some(n => /note-caution/.test(n.cls) && /Augmented renal clearance suspected/.test(n.word) && /CrCl ≈ 303 mL\/min/.test(n.text)),
       JSON.stringify(arc.notes.map(n => n.word)));
    // Task 3 review: under the refusal, the explorer never shows the removed 7.5 g a day as in range.
    const over = await c.evaluate(() => { const th = [...document.querySelectorAll('#results-content .tx-explorer th, #results-content table th')].find(t => /^2\.5 g q8h/.test(t.textContent.trim()));
      const tr = th && th.closest('tr'); return tr ? { text: tr.textContent.replace(/\s+/g, ' ').trim(), cls: tr.className, inRange: tr.querySelectorAll('td.in-range').length, aucCls: (tr.querySelectorAll('td')[2] || {}).className } : null; });
    ok('D26 review: the dose explorer marks 2.5 g q8h over the ceilings, its AUC not in range', !!over && /over 2 g a dose/.test(over.text) && /over 4\.5 g a day/.test(over.text)
       && /is-over/.test(over.cls) && over.aucCls !== 'in-range', JSON.stringify(over));
    // The same patient on random-level mode with an early, low level (CL 12.6 L/h): a refusal too.
    await c.locator('#mode-btn-randomlevel').click();
    await typeInto(c, '#rl-dose', '1000'); await typeInto(c, '#rl-tinf', '1'); await typeInto(c, '#rl-c', '3');
    await c.locator('#rl-dose-time-date').fill(day(0)); await typeInto(c, '#rl-dose-time-time', '0000');
    await c.locator('#rl-draw-time-date').fill(day(0)); await typeInto(c, '#rl-draw-time-time', '0800');
    await c.locator('#rl-tau').selectOption('12');
    await c.locator('[data-onclick="k31"]').click(); await c.waitForTimeout(500);
    const rl = await verdictOf();
    ok('D26: Trough random level renders the refusal with the cap-bound alarm',
       rl.reg === 'No regimen recommended' && rl.hold && !rl.dose && rl.notes.some(n => /note-alarm/.test(n.cls) && /conventional ceilings/.test(n.text)), JSON.stringify(rl).slice(0, 600));
    // I1: CrCl 6.5, no HD, initial mode, no level.
    await c.locator('#mode-btn-initial').click();
    await typeInto(c, '#age', '85'); await typeInto(c, '#tbw', '45'); await typeInto(c, '#height', '155'); await typeInto(c, '#scr', '4.5');
    await c.locator('[data-onclick="k10"]').first().click();
    await c.locator('#init-interval').selectOption('48');
    await c.locator('[data-onclick="k31"]').click(); await c.waitForTimeout(500);
    const sev = await verdictOf();
    ok('D26: Trough withholds at CrCl 6.5 — "No empiric maintenance regimen" with the severe-renal advisory, no dose',
       sev.reg === 'No empiric maintenance regimen' && sev.hold && !sev.dose && /^Result: No empiric maintenance regimen/.test(sev.said)
       && sev.notes.some(n => /note-alarm/.test(n.cls) && /Severe renal impairment \(non-dialysis\) suspected/.test(n.word) && /loading dose/.test(n.text)),
       JSON.stringify(sev).slice(0, 600));
    // Task 4 (models report I4, ruling 8): only sourced numbers — Rec 11's basis and maximum, then measured
    // levels; none of the unsourced 15–20 mg/kg, max 2 g, 24–48 h or q24h–q72h; no Bayesian fit in the Trough module.
    const sevNote = (sev.notes.find(n => /Severe renal impairment/.test(n.word)) || {}).text || '';
    const sevAll = sev.why + ' ' + sevNote;
    ok('D26 Task 4: the Trough severe-renal refusal names Rybak 2020 Rec 11 (actual body weight, at most 3 g), then measured levels; no unsourced number, no Bayesian fit',
       /Rybak 2020 Rec 11/.test(sev.why) && /Rybak 2020 Rec 11/.test(sevNote) && /actual body weight, at most 3 g/.test(sevNote) && /measured level/.test(sev.why) && /measured level/.test(sevNote)
       && !/15\s*[–-]\s*20 mg\/kg|max 2 g|24\s*[–-]\s*48 h|q24h\s*[–-]\s*q72h|Bayesian|re-fit/i.test(sevAll), sevAll.slice(0, 700));
    // Task 3 review (ruling R7): the refusal names the intervals that reach 400-600 within the ceilings.
    // 30 M, 80 kg, 180 cm, SCr 0.7 (CrCl ~175) at q24h: bound at q24h, not at q8h or q12h.
    await typeInto(c, '#age', '30'); await typeInto(c, '#tbw', '80'); await typeInto(c, '#height', '180'); await typeInto(c, '#scr', '0.7');
    await c.locator('[data-onclick="k9"]').first().click();
    await c.locator('#init-interval').selectOption('24');
    await c.locator('[data-onclick="k31"]').click(); await c.waitForTimeout(500);
    const r7 = await verdictOf();
    const r7next = await c.evaluate(() => ((document.querySelector('#results-content .tx-verdict .vx-next') || {}).textContent || ''));
    ok('D26 review: a q24h cap-bound refusal names the shorter intervals that work, at q24h only, with no specialist line and no "obtain a level"',
       r7.reg === 'No regimen recommended' && /IV q8h|IV q12h/.test(r7.why) && r7.notes.some(n => /At q24h the target cannot be reached/.test(n.text))
       && !r7.notes.some(n => /alternative agent|specialist/.test(n.text)) && !/level/i.test(r7next), JSON.stringify({ r7, r7next }).slice(0, 700));
    // 80 F, 45 kg, 155 cm, SCr 2.65 (CrCl ~12) at q24h: the 250 mg lattice steps over the band; only q36h and q48h work.
    await typeInto(c, '#age', '80'); await typeInto(c, '#tbw', '45'); await typeInto(c, '#height', '155'); await typeInto(c, '#scr', '2.65');
    await c.locator('[data-onclick="k10"]').first().click();
    await c.locator('#init-interval').selectOption('24');   // the CrCl readout suggests an interval; choose q24h after it
    await c.locator('[data-onclick="k31"]').click(); await c.waitForTimeout(500);
    const gap = await verdictOf();
    ok('D26 review: a gap refusal at q24h names q36h and q48h, not the dose explorer',
       gap.reg === 'No regimen recommended' && /IV q36h/.test(gap.why) && /IV q48h/.test(gap.why) && !/dose explorer/i.test(gap.why), JSON.stringify(gap).slice(0, 600));
    // Task 4b (ruling R10): the Trough loading dose obeys Rybak 2020 Rec 11 (at most 3,000 mg). Fictional
    // 70 M, 130 kg, 175 cm, SCr 2.0 on the Buelga volume (127 L): 3.25 g before the cap.
    await typeInto(c, '#age', '70'); await typeInto(c, '#tbw', '130'); await typeInto(c, '#height', '175'); await typeInto(c, '#scr', '2.0');
    await c.locator('[data-onclick="k9"]').first().click();
    await c.locator('#vd-model').selectOption('buelga');
    await c.evaluate(() => { const x = document.getElementById('has-ld'); if (x && !x.checked) x.click(); });
    await c.locator('#init-interval').selectOption('24');
    await c.locator('[data-onclick="k31"]').click(); await c.waitForTimeout(500);
    const ldCap = await c.evaluate(() => { const s = document.querySelector('#results-content .tx-ld');
      return s ? { dose: ((s.querySelector('.tx-ld-dose') || {}).textContent || '').trim(), text: s.textContent.replace(/\s+/g, ' ').trim() } : null; });
    ok('D26: the Trough loading dose is capped at 3 g', !!ldCap && ldCap.dose === '3 g IV once' && /Rybak 2020 Rec 11/.test(ldCap.text) && /maximum of 3 g/.test(ldCap.text),
       JSON.stringify(ldCap).slice(0, 700));
    await c.locator('#vd-model').selectOption('vancopk');
    await c.evaluate(() => { const x = document.getElementById('has-ld'); if (x && x.checked) x.click(); });
    const cAttr2 = await attributeInjected(c, cProblems);
    results.cloudflareInjected = (results.cloudflareInjected || 0) + cAttr2.injected;
    results.problems.push(...cAttr2.kept);
    await cctx.close();
  }

  // v3.14.0 (D26), engine report I6 (ruling R14): two levels on the steady-state basis, q12h, 1 g over 1 h,
  // 25.9 mg/L at 2 h and 12.95 mg/L at 56 h. A level later than the interval (plus the 0.5 h trough-timing
  // window) means another dose came in between: refused, naming the times and the interval. The same times
  // after the first dose are accepted. Fictional patient: 25 M, 95 kg, 185 cm, SCr 0.5.
  {
    const tctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const t = await tctx.newPage();
    const tProblems = watch(t, 'two-level-late');
    await t.goto(BASE + '?v=tll-' + Date.now(), { waitUntil: 'networkidle' });
    await t.locator('[data-onclick="k1"]').click();
    await typeInto(t, '#age', '25'); await typeInto(t, '#tbw', '95'); await typeInto(t, '#height', '185'); await typeInto(t, '#scr', '0.5');
    await t.locator('[data-onclick="k9"]').first().click();
    await t.locator('#mode-btn-twolevels').click();
    await typeInto(t, '#tl-dose', '1000'); await typeInto(t, '#tl-tinf', '1'); await t.locator('#tl-tau').selectOption('12');
    await typeInto(t, '#tl-c1', '25.9'); await typeInto(t, '#tl-c2', '12.95');
    await t.locator('#tl-dose-time-date').fill(day(0)); await typeInto(t, '#tl-dose-time-time', '0000');
    await t.locator('#tl-t1-time-date').fill(day(0)); await typeInto(t, '#tl-t1-time-time', '0200');
    await t.locator('#tl-t2-time-date').fill(day(2)); await typeInto(t, '#tl-t2-time-time', '0800');
    await t.locator('[data-onclick="k25"]').click();
    await t.locator('#tl-cur-tau').selectOption('12');
    await t.locator('[data-onclick="k31"]').click(); await t.waitForTimeout(500);
    const fe = (await t.locator('#fe-trough').textContent().catch(() => '')).replace(/\s+/g, ' ');
    ok('D26: two levels at steady state, Level 2 at 56 h on a q12h interval — refused, naming the times and the interval',
       /Level 2 was drawn later than the 12 h interval/.test(fe) && /Level 2 at 56\.0 h/.test(fe) && /before the next dose/.test(fe), fe.slice(0, 500));
    ok('D26: no regimen or volume is shown for the late level', (await t.locator('#results-content .rec-dose').count()) === 0);
    await t.locator('[data-onclick="k24"]').click();
    await t.locator('[data-onclick="k31"]').click(); await t.waitForTimeout(500);
    const fe2 = await t.locator('#fe-trough').isVisible().catch(() => false);
    ok('D26: the same levels on the first-dose basis are accepted', !fe2 && (await t.locator('#results-content .tx-verdict, #results-content .tx-regimen, #tx-regimen').count()) > 0);
    results.problems.push(...tProblems);
    await tctx.close();
  }

  // v3.12.0 (D23): IV vancomycin on peritoneal dialysis, typed in. A fictional CCPD patient
  // (61 kg at the load, 63 kg now, cycler 21:00 x 9.5 h), on a fixed clock (today 10:00) so the
  // answer cannot depend on the time of day.
  {
    const pctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pd = await pctx.newPage();
    const pdProblems = watch(pd, 'pd');
    await pd.clock.setFixedTime(new Date(`${day(0)}T10:00`));
    await pd.goto(BASE + '?v=pwpd-' + Date.now(), { waitUntil: 'networkidle' });
    await pd.locator('.module-tab', { hasText: 'Trough' }).first().click();
    await pd.locator('#mode-btn-pd').click();
    await typeInto(pd, '#tbw', '63');
    await pd.selectOption('#pd-modality', 'ccpd');
    await typeInto(pd, '#pd-start', '2100'); await typeInto(pd, '#pd-hours', '9.5'); await typeInto(pd, '#pd-exchanges', '5'); await typeInto(pd, '#pd-fill', '2');
    await pd.selectOption('#pd-prior', 'no'); await pd.selectOption('#pd-urine', 'anuric');
    await typeInto(pd, '#pd-load-kg', '61');
    await pd.locator('[data-onclick="k85"][data-arg="10|15"]').click();
    const pdDose = async (n, mg, tinf, d, t) => { await pd.locator('[data-onclick="k86"]').click(); await typeInto(pd, `#pd-dose-mg-${n}`, mg); await typeInto(pd, `#pd-dose-tinf-${n}`, tinf); await pd.locator(`#pd-dose-date-${n}`).fill(d); await typeInto(pd, `#pd-dose-time-${n}`, t); };
    const pdLvl = async (n, c, d, t) => { await pd.locator('[data-onclick="k88"]').click(); await typeInto(pd, `#pd-lvl-conc-${n}`, c); await pd.locator(`#pd-lvl-date-${n}`).fill(d); await typeInto(pd, `#pd-lvl-time-${n}`, t); };
    await pdDose(1, '1250', '1.5', day(-4), '0410'); await pdLvl(1, '12.4', day(-2), '0700');
    await pdDose(2, '500', '1', day(-2), '0900'); await pdLvl(2, '14.8', day(-1), '0715');
    const pdRun = async () => { await pd.locator('[data-onclick="k31"]').click(); await pd.waitForSelector('#results-content .pd-verdict', { timeout: 20000 }); await pd.waitForTimeout(250); };
    const pdRead = () => pd.evaluate(() => {
      const t = (s) => ((document.querySelector(s) || {}).textContent || '').replace(/\s+/g, ' ').trim();
      const rec = document.querySelector('#results-content tr.is-rec th');
      return { verdict: t('#results-content .pd-verdict'), rec: rec ? rec.textContent.replace(/\s+/g, ' ').trim() : '',
        decline: t('#pd-decline'), notes: t('#results-content .tx-notes'),
        cyc: document.querySelectorAll('#results-content svg .pd-cycler').length, lv: document.querySelectorAll('#results-content svg .pd-lv').length };
    });
    const mgOf = (v) => { const m = v.match(/Give ([\d.]+) (g|mg) IV/); return m ? (m[2] === 'g' ? +m[1] * 1000 : +m[1]) : 0; };
    await pdRun();
    const p1 = await pdRead();
    ok('PD: the fictional CCPD patient gets an answer — a dose or none, the expected level at the next draw, and when to draw it',
       /^(Give [\d.]+ (g|mg) IV|No dose today)/.test(p1.verdict) && /Expected [\d.]+–[\d.]+ mg\/L at/.test(p1.verdict) && /Draw the next level/.test(p1.verdict), p1.verdict.slice(0, 300));
    {
      const paper = await pd.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return ((document.getElementById('print-report') || {}).textContent || '').replace(/\s+/g, ' '); });
      ok('D26: print says not clinically validated (PD result)', /Peritoneal|peritoneal/.test(paper) && /not clinically validated/.test(paper) && /Clinician judgment required/.test(paper), paper.slice(-300));
      await pd.goto(BASE + '?v=pwpd-empty-' + Date.now(), { waitUntil: 'networkidle' });
      await pd.locator('.module-tab', { hasText: 'Trough' }).first().click();
      const empty = await pd.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return ((document.getElementById('print-report') || {}).textContent || '').replace(/\s+/g, ' '); });
      ok('D26: print says not clinically validated (empty state)', /not clinically validated/.test(empty) && /Clinician judgment required/.test(empty), empty.slice(-300));
      await pd.goto(BASE + '?v=pwpd-empty2-' + Date.now(), { waitUntil: 'networkidle' });
      await pd.locator('.module-tab', { hasText: 'AUC' }).first().click();
      const empty2 = await pd.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return ((document.getElementById('print-report') || {}).textContent || '').replace(/\s+/g, ' '); });
      ok('D26: print says not clinically validated (empty AUC)', /not clinically validated/.test(empty2), empty2.slice(-300));
      await pd.goto(BASE + '?v=pwpd-back-' + Date.now(), { waitUntil: 'networkidle' });
      await pd.locator('.module-tab', { hasText: 'Trough' }).first().click();
      await pd.locator('#mode-btn-pd').click();
      await typeInto(pd, '#tbw', '63');
      await pd.selectOption('#pd-modality', 'ccpd');
      await typeInto(pd, '#pd-start', '2100'); await typeInto(pd, '#pd-hours', '9.5'); await typeInto(pd, '#pd-exchanges', '5'); await typeInto(pd, '#pd-fill', '2');
      await pd.selectOption('#pd-prior', 'no'); await pd.selectOption('#pd-urine', 'anuric');
      await typeInto(pd, '#pd-load-kg', '61');
      await pd.locator('[data-onclick="k85"][data-arg="10|15"]').click();
      await pdDose(1, '1250', '1.5', day(-4), '0410'); await pdLvl(1, '12.4', day(-2), '0700');
      await pdDose(2, '500', '1', day(-2), '0900'); await pdLvl(2, '14.8', day(-1), '0715');
      await pdRun();
    }
    ok('PD: the second interval is flagged early; the options mark the recommendation; the chart shows the levels and cycler nights',
       /within 24 h of a dose ending/.test(p1.decline) && (mgOf(p1.verdict) ? p1.rec.startsWith(p1.verdict.match(/Give ([\d.]+ (?:g|mg))/)[1]) : p1.rec === 'No dose') && p1.lv === 2 && p1.cyc >= 1, JSON.stringify(p1).slice(0, 400));
    const pdD24 = await pd.evaluate(() => { const svg = document.querySelector('#results-content svg.pd-chart'), txt = svg && svg.querySelector('text');
      return { px: svg && txt ? +(parseFloat(getComputedStyle(txt).fontSize) * svg.getBoundingClientRect().width / svg.viewBox.baseVal.width).toFixed(1) : 0,
        hidden: ['amp-section', 'section-renal', 'section-ld'].map(id => !document.getElementById(id).offsetParent),
        verdict: document.querySelector('#results-content .pd-verdict').textContent.replace(/\s+/g, ' '),
        notes: ((document.querySelector('#results-content .tx-notes') || {}).textContent || '') }; });
    ok('D24 PD: chart text at 12 px on screen; no amputation, creatinine or loading-dose blocks; the draw is the AM labs, no cycler wording',
       pdD24.px >= 11.9 && pdD24.hidden.every(Boolean) && !/cycler|see below/i.test(pdD24.verdict) && /with AM labs/.test(pdD24.verdict) && !/Draw after the cycler/.test(pdD24.notes), JSON.stringify(pdD24).slice(0, 300));
    const printed = await pd.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); return (document.getElementById('print-report') || {}).innerHTML || ''; });
    ok('PD: the weight change is said; print carries the answer and its chart',
       /Weight changed since the load/.test(p1.notes) && /pd-verdict/.test(printed) && /pd-chart/.test(printed), p1.notes.slice(0, 200));
    await pd.locator('[data-onclick="k85"][data-arg="15|20"]').click(); await pdRun();
    const p2 = await pdRead();
    ok('PD: a 15–20 goal asks for more than 10–15', mgOf(p2.verdict) > mgOf(p1.verdict), `${mgOf(p1.verdict)} → ${mgOf(p2.verdict)}`);
    await pd.locator('#pd-ip').check(); await pdRun();
    ok('PD: intraperitoneal vancomycin as well is refused', /Intraperitoneal vancomycin as well/.test((await pdRead()).verdict));
    await pd.locator('#pd-ip').uncheck();
    await pd.setViewportSize({ width: 375, height: 812 }); await pdRun();
    const pw = await pd.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok('PD at 375 px: no horizontal overflow', pw.sw <= pw.iw, JSON.stringify(pw));
    await pd.setViewportSize({ width: 1280, height: 900 });
    await pd.locator('.module-tab', { hasText: 'AUC' }).first().click();
    await pd.locator('#b-pd').check();
    await pd.locator('[data-onclick="k47"]').click(); await pd.waitForTimeout(300);
    const refusal = await pd.evaluate(() => ((document.getElementById('b-results') || {}).textContent || '').replace(/\s+/g, ' '));
    await pd.locator('#b-results [data-onclick="k93"]').click(); await pd.waitForTimeout(200);
    const opened = await pd.evaluate(() => ({ on: document.getElementById('mode-btn-pd').classList.contains('active'), shown: !!document.getElementById('section-pd').offsetParent }));
    ok('AUC Precision refuses a PD patient; its link opens the PD mode', /On peritoneal dialysis/.test(refusal) && opened.on && opened.shown, refusal.slice(0, 160) + ' ' + JSON.stringify(opened));
    const pAttr = await attributeInjected(pd, pdProblems);
    results.cloudflareInjected = (results.cloudflareInjected || 0) + pAttr.injected;
    results.problems.push(...pAttr.kept);
    await pctx.close();
  }

  // v3.13.0 (D24): the workstation, 1280 × 800. A fictional class-3 obese patient (140 kg,
  // 180 cm, BMI 43.2) on Buelga, so the model mismatch shows; the D1/D2 course above.
  {
    const wctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const w = await wctx.newPage();
    const wProblems = watch(w, 'workstation');
    await w.goto(BASE + '?v=pwws-' + Date.now(), { waitUntil: 'networkidle' });
    await w.locator('[data-onclick="k2"]').click();
    await typeInto(w, '#b-age', '55'); await typeInto(w, '#b-tbw', '140'); await typeInto(w, '#b-height', '180'); await typeInto(w, '#b-scr', '1.0');
    await w.locator('[data-onclick="k39"]').click();
    const tiles = () => w.evaluate(() => [...document.querySelectorAll('#b-model-toggle .model-opt')]
      .map(b => b.id.replace('b-model-btn-', '') + ':' + b.classList.contains('is-suggested') + ':' + b.classList.contains('active')).join(','));
    const t0 = await tiles();
    ok('D24: BMI 43 marks Hughes 2024 as suggested on its tile and leaves Buelga chosen', t0 === 'buelga:false:true,goti:false:false,hughes:true:false,gotihd:false:false', t0);
    await enterCourse(w);
    await w.locator('[data-onclick="k43"]').click();
    const f5 = await w.evaluate(() => document.activeElement && document.activeElement.id);
    ok('D24: + Add dose puts the cursor in the new row', f5 === 'b-dose-mg-5', f5);
    await w.locator('[data-onclick="k61"][data-arg="5"]').click();
    const lay = await w.evaluate(() => { const pl = document.querySelector('#app-shell-bayesian > .panel-left'), run = pl.querySelector('.panel-actions [data-onclick="k47"]').getBoundingClientRect();
      return { pos: getComputedStyle(pl).position, own: pl.scrollHeight > pl.clientHeight, runBottom: Math.round(run.bottom), h: innerHeight,
        clearBesideRun: !pl.querySelector('.panel-actions [data-onclick="k48"]') }; });
    ok('D24: the input column scrolls on its own; Run is pinned on screen at its foot; Clear is not beside it',
       lay.pos === 'sticky' && lay.own && lay.runBottom <= lay.h && lay.clearBesideRun, JSON.stringify(lay));
    await w.locator('[data-onclick="k47"]').click();
    await w.waitForSelector('#b-results .rec-dose', { timeout: 20000 }); await w.waitForTimeout(600);
    const a1 = await w.evaluate(() => { const t = (q) => ((document.querySelector(q) || {}).textContent || '').replace(/\s+/g, ' ').trim();
      const reg = document.getElementById('ev-regimens');
      return { dose: t('#b-results .vx-regimen'), y: Math.round(scrollY), mm: t('#b-results .vx-mismatch'), gist: t('#ev-models .ev-gist'),
        regOpen: !!reg && reg.open, regGist: t('#ev-regimens .ev-gist'), mathGuide: !!document.querySelector('#ev-math .guideline-line'),
        regGuide: !!document.querySelector('#ev-regimens .guideline-line'), print: !!document.querySelector('#b-results .vx-actions [data-onclick="k0"]') }; });
    ok('D24: a run leaves the window where it was (the answer is beside the inputs)', a1.y === 0, a1.y);
    ok('D24: the model mismatch is one line in the confidence slot and leads the Models gist',
       /Hughes 2024 is fitted to class 3 obesity \(BMI 43\.2\); this result uses Buelga 2005\./.test(a1.mm) && /^Suggested: Hughes 2024 · /.test(a1.gist), JSON.stringify([a1.mm, a1.gist]));
    ok('D24: Regimens opens closed, its gist naming the band count and the recommendation; the guideline line is in Show the math',
       !a1.regOpen && /^\d+ within 400–600 · recommended [\d.]+ (g|mg) IV q\d+h$/.test(a1.regGist) && a1.mathGuide && !a1.regGuide, JSON.stringify(a1));
    // The Regimens pick: a cell other than the recommendation.
    await w.locator('#ev-regimens > summary').click();
    const cell = w.locator('#b-results .mx-cell.mx-in:not(.is-rec)').first();
    const arg = await cell.getAttribute('data-arg');
    await cell.click(); await w.waitForTimeout(400);
    const pick = await w.evaluate((arg) => { const c = document.querySelector(`.mx-cell[data-arg="${arg}"]`), r = document.getElementById('b-tink-result');
      return { pressed: c.getAttribute('aria-pressed'), word: (c.querySelector('.mx-trying') || {}).textContent || '', explore: document.getElementById('ev-explore').open,
        shown: !!r && r.style.display !== 'none' && r.offsetParent !== null, said: document.getElementById('sr-announce').textContent,
        others: document.querySelectorAll('.mx-cell[aria-pressed="true"]').length, dose: document.getElementById('b-tink-dose').value }; }, arg);
    ok('D24: a picked Regimens cell is pressed, says "trying", opens Explore with the result, and is announced',
       pick.pressed === 'true' && pick.word === 'trying' && pick.explore && pick.shown && /^Trying /.test(pick.said) && pick.others === 1 && pick.dose === arg.split('|')[0], JSON.stringify(pick));
    // Enter in Explore previews; it used to recalculate and close the section.
    await w.evaluate(() => { document.getElementById('ev-explore').dataset.mark = 'kept'; });
    await typeInto(w, '#b-tink-dose', '1250'); await w.locator('#b-tink-dose').press('Enter'); await w.waitForTimeout(400);
    const ent = await w.evaluate(() => { const e = document.getElementById('ev-explore'); return { kept: !!e && e.dataset.mark === 'kept', open: !!e && e.open,
      res: ((document.getElementById('b-tink-result') || {}).textContent || '').replace(/\s+/g, ' ').slice(0, 80) }; });
    ok('D24: Enter in Explore previews the dose and keeps the section open', ent.kept && ent.open && /AUC/.test(ent.res), JSON.stringify(ent));
    // Enter in the profile name saves.
    await typeInto(w, '#profile-label-input', 'WS fictional'); await w.locator('#profile-label-input').press('Enter'); await w.waitForTimeout(300);
    const prof = await w.evaluate(() => ({ kept: (document.getElementById('ev-explore') || {}).dataset?.mark === 'kept',
      listed: [...document.querySelectorAll('#profile-list .profile-item')].some(e => /WS fictional/.test(e.textContent)),
      status: ((document.querySelector('#app-shell-bayesian .profile-status') || {}).textContent || '').trim() }));
    ok('D24: Enter in the profile name saves the profile and runs nothing', prof.kept && prof.listed && /^Saved/.test(prof.status), JSON.stringify(prof));
    // The Regimens grid: the trough figure and a blocked cell read at 4.5:1 or better.
    const cr = await w.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
      const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const over = (top, under) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3]));
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const paper = rgba(getComputedStyle(document.body).backgroundColor).slice(0, 3);
      const out = {};
      for (const k of ['mx-in', 'mx-sub-b', 'mx-supra', 'mx-blocked']) {
        const c = document.querySelector(`#b-results .mx-cell.${k}`); if (!c) continue;
        const bg = over(rgba(getComputedStyle(c).backgroundColor), paper), tr = c.querySelector('.mx-tr');
        out[k] = +ratio(over(rgba(getComputedStyle(tr).color), bg), bg).toFixed(2);
      }
      return out; });
    ok('D24: Regimens trough figures and blocked cells pass 4.5:1', Object.keys(cr).length >= 2 && Object.values(cr).every(x => x >= 4.5), JSON.stringify(cr));
    // Clear, then Undo: the course comes back and gives the same answer.
    await w.locator('[data-onclick="k48"]').click(); await w.waitForTimeout(200);
    const cleared = await w.evaluate(() => ({ age: document.getElementById('b-age').value, rows: document.querySelectorAll('[id^="b-dose-row-"]').length,
      undo: !!document.querySelector('#undo-auc [data-onclick="k97"]') }));
    await w.locator('#undo-auc [data-onclick="k97"]').click(); await w.waitForTimeout(300);
    const back = await w.evaluate(() => ({ age: document.getElementById('b-age').value, rows: document.querySelectorAll('[id^="b-dose-row-"]').length,
      lvl: (document.getElementById('b-lvl-conc-1') || {}).value, male: document.querySelector('[data-onclick="k39"]').classList.contains('active'),
      rb: ((document.getElementById('course-rb-dose-3') || {}).textContent || '').trim() }));
    ok('D24: Clear all fields empties the form and offers Undo; Undo puts every row and value back',
       cleared.age === '' && cleared.rows === 0 && cleared.undo && back.age === '55' && back.rows === 4 && back.lvl === '15.2' && back.male && /after dose/.test(back.rb), JSON.stringify([cleared, back]));
    await w.locator('[data-onclick="k47"]').click();
    await w.waitForSelector('#b-results .rec-dose', { timeout: 20000 }); await w.waitForTimeout(400);
    const again = await w.evaluate(() => ((document.querySelector('#b-results .vx-regimen') || {}).textContent || '').replace(/\s+/g, ' ').trim());
    ok('D24: the restored form gives the same answer', again === a1.dose, `${a1.dose} → ${again}`);
    // The final review's paths (2026-11-10). A serial SCr row (no ids) survives Clear and Undo.
    await w.locator('[data-onclick="k42"]').click();
    await w.locator('#b-scr-tbody tr:last-child .b-scr-val').fill('1.4');
    await w.locator('[data-onclick="k48"]').click(); await w.locator('#undo-auc [data-onclick="k97"]').click(); await w.waitForTimeout(200);
    const scrBack = await w.evaluate(() => (document.querySelector('#b-scr-tbody tr:last-child .b-scr-val') || {}).value);
    ok('D24 review: a serial SCr value comes back with Undo', scrBack === '1.4', scrBack);
    // Loading a profile ends the Undo, so a cleared form can never be restored over a loaded one.
    await w.locator('[data-onclick="k48"]').click();
    await w.locator('#app-shell-bayesian .profile-item-btn.load').first().click(); await w.waitForTimeout(300);
    ok('D24 review: loading a profile ends the Undo', (await w.locator('[data-onclick="k97"]').count()) === 0);
    // Trough: a cleared form leaves no CrCl override active; Undo brings it back consistent.
    await w.locator('[data-onclick="k1"]').click();
    await w.locator('#crcl-override-on').check(); await typeInto(w, '#crcl-override-val', '30');
    const aucMg = await w.evaluate(() => (document.getElementById('b-dose-mg-1') || {}).value);
    await w.locator('[data-onclick="k32"]').click(); await w.waitForTimeout(200);
    const ov1 = await w.evaluate(() => ({ box: document.getElementById('crcl-override-on').checked, on: crclOverride.on, auc: (document.getElementById('b-dose-mg-1') || {}).value }));
    await w.locator('#undo-trough [data-onclick="k97"]').click(); await w.waitForTimeout(200);
    const ov2 = await w.evaluate(() => ({ box: document.getElementById('crcl-override-on').checked, on: crclOverride.on, v: crclOverride.value }));
    ok('D24 review: Clear leaves no CrCl override active and leaves the AUC form alone; Undo restores the override with its box',
       !ov1.box && !ov1.on && ov1.auc === aucMg && !!aucMg && ov2.box && ov2.on && ov2.v === 30, JSON.stringify({ ov1, ov2, aucMg }));
    await w.locator('[data-onclick="k2"]').click(); await w.locator('[data-onclick="k43"]').click();
    const dupes = await w.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return ids.filter((x, i) => ids.indexOf(x) !== i); });
    ok('D24 review: a row added after the Trough Undo has a unique id', dupes.length === 0, JSON.stringify(dupes.slice(0, 5)));
    await w.screenshot({ path: path.join(OUT, 'desktop-1280-workstation.png') });
    const wAttr = await attributeInjected(w, wProblems);
    results.cloudflareInjected = (results.cloudflareInjected || 0) + wAttr.injected;
    results.problems.push(...wAttr.kept);
    await wctx.close();
  }

  // D27 (models review I3, Task 18): Hughes 2024 was built in CrCl on fat-free mass 13-255 mL/min
  // (Table 1). A fictional 25 M, 200 kg, 185 cm, SCr 0.5 on Hughes has 307: one caution line in the
  // confidence slot says so. The 45 M, 140 kg, 175 cm, SCr 1.0 patient (103) gets none. The D1/D2 course.
  {
    const octx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const o = await octx.newPage();
    const oProblems = watch(o, 'hughes-range');
    await o.goto(BASE + '?v=pwhr-' + Date.now(), { waitUntil: 'networkidle' });
    await o.locator('[data-onclick="k2"]').click();
    await typeInto(o, '#b-age', '25'); await typeInto(o, '#b-tbw', '200'); await typeInto(o, '#b-height', '185'); await typeInto(o, '#b-scr', '0.5');
    await o.locator('[data-onclick="k39"]').click();
    await o.locator('#b-model-btn-hughes').click();
    await enterCourse(o);
    const slot = () => o.evaluate(() => {
      const mm = [...document.querySelectorAll('#b-results .vx-mismatch')];
      return { n: mm.length, text: mm.map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
        inConf: mm.every(e => !!e.closest('.vx-conf')), caution: mm.every(e => e.classList.contains('tone-caution') && !!e.querySelector('svg.ic')),
        alarm: mm.some(e => e.classList.contains('tone-alarm')), gist: ((document.querySelector('#ev-models .ev-gist') || {}).textContent || '').trim() };
    });
    await o.locator('[data-onclick="k47"]').click();
    await o.waitForSelector('#b-results .rec-dose', { timeout: 20000 }); await o.waitForTimeout(300);
    const out = await slot();
    ok('D27: Hughes out-of-population line: CrCl on fat-free mass above the built range is one caution line in the confidence slot',
       out.n === 1 && out.inConf && out.caution && !out.alarm
       && /^Hughes 2024 was built in patients with CrCl on fat-free mass 13–255 mL\/min; this patient's 307 mL\/min is above that range\.$/.test(out.text)
       && !/^Suggested:/.test(out.gist), JSON.stringify(out));
    await typeInto(o, '#b-age', '45'); await typeInto(o, '#b-tbw', '140'); await typeInto(o, '#b-height', '175'); await typeInto(o, '#b-scr', '1.0');
    await o.locator('[data-onclick="k47"]').click();
    await o.waitForSelector('#b-results .rec-dose', { timeout: 20000 }); await o.waitForTimeout(300);
    const inRange = await slot();
    ok('D27: Hughes out-of-population line: an in-range Hughes patient gets none', inRange.n === 0, JSON.stringify(inRange));
    const oAttr = await attributeInjected(o, oProblems);
    results.cloudflareInjected = (results.cloudflareInjected || 0) + oAttr.injected;
    results.problems.push(...oAttr.kept);
    await octx.close();
  }
  await browser.close();

  results.checks = checks;
  const failed = checks.filter(c => !c.pass);
  console.log(JSON.stringify(results, null, 1));
  const cf = results.cloudflareInjected ? `; ${results.cloudflareInjected} Cloudflare-injected inline script(s) refused by the CSP, as designed` : '';
  console.log(`\n${checks.length - failed.length}/${checks.length} checks pass; ${results.problems.length} console problem(s)${cf}; screenshots in ${OUT}`);
  process.exit(failed.length || results.problems.length ? 1 : 0);
})().catch(e => { console.error('RUN FAILED:', e); process.exit(2); });
