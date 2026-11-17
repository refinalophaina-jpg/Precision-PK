// Usage: TZ=America/Chicago node capture.cjs <repoDir> <htmlPath> <outJson>
// Runs phase2d_validation.cjs with SUITE 41's pdAnswer / pdIntervals calls recorded (the raw calls, which
// encode.cjs turns into fixtures58.json). It patches the harness text at two markers; if SUITE 41 or 42 is
// renamed it throws ('not unique') rather than recording the wrong suite.
const fs = require('fs'), path = require('path'), Module = require('module');
const [repo, htmlPath, out] = process.argv.slice(2).map(a => path.resolve(a));
const file = path.join(repo, 'phase2d_validation.cjs');
let src = fs.readFileSync(file, 'utf8');
const rep = (a, b) => { if (src.split(a).length !== 2) throw new Error('not unique: ' + a); src = src.replace(a, b); };
rep("const htmlPath = path.join(__dirname, 'index.html');", `const htmlPath = ${JSON.stringify(htmlPath)};`);
rep("  const K41 = require('./harness_constants.cjs').extract();",
`  const K41 = require('./harness_constants.cjs').extract();
  globalThis.__CAP = []; const __o = { pdAnswer: sandbox.pdAnswer, pdIntervals: sandbox.pdIntervals }; let __depth = 0;
  for (const fn of ['pdAnswer', 'pdIntervals']) sandbox[fn] = function (...args) {
    const rec = __depth === 0 ? { fn, args: JSON.parse(JSON.stringify(args)) } : null;
    __depth++; let r, err;
    try { r = __o[fn].apply(this, args); } catch (e) { err = e; } finally { __depth--; }
    if (rec) { if (err) rec.threw = String(err.message); else rec.out = JSON.parse(JSON.stringify(r)); globalThis.__CAP.push(rec); }
    if (err) throw err; return r;
  };
  globalThis.__RESTORE = () => { sandbox.pdAnswer = __o.pdAnswer; sandbox.pdIntervals = __o.pdIntervals; };`);
rep("// SUITE 42 — the workstation (v3.13.0, D24)", "// SUITE 42 —\nglobalThis.__RESTORE(); require('fs').writeFileSync(" + JSON.stringify(out) + ", JSON.stringify(globalThis.__CAP));");
const m = new Module(file, null); m.filename = file; m.paths = Module._nodeModulePaths(repo);
m._compile(src, file);
