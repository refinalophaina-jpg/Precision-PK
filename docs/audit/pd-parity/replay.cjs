// TZ=America/Chicago node docs/audit/pd-parity/replay.cjs <repo> <html> [fixtures.json] [digits]
// Prints the expected-digest lines of phase2d_validation.cjs test 46.44, computed by replaying the encoded
// fixtures against <html> exactly as the test does: every number rounded to <digits> significant digits
// (default 9, ruling R87) before the SHA-256 of the output's JSON. <repo> supplies the harness (load.cjs).
const crypto = require('crypto'), path = require('path');
const [repo, html, fxArg, digitsArg] = process.argv.slice(2);
if (!repo || !html) { console.error('usage: TZ=America/Chicago node replay.cjs <repo> <html> [fixtures.json] [digits]'); process.exit(2); }
const DIGITS = Number(digitsArg) > 0 ? Number(digitsArg) : 9;
const sb = require('./load.cjs')(path.resolve(repo), path.resolve(html));
const fx = require(path.resolve(fxArg || path.join(__dirname, 'fixtures58.json')));
const H = (d, hm) => { const [h, m] = hm.split(':').map(Number); return new Date(2026, 5, 10 + d, h, m).getTime() / 3600000; };
const dec = (v) => Array.isArray(v) ? v.map(dec) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)]))
  : typeof v === 'string' && /^@-?\d+\|\d\d:\d\d$/.test(v) ? H(+v.slice(1, v.indexOf('|')), v.slice(v.indexOf('|') + 1)) : v;
const norm = (v) => Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]))
  : typeof v === 'number' ? Number(v.toPrecision(DIGITS)) : v;
const digest = (r) => crypto.createHash('sha256').update(JSON.stringify(norm(JSON.parse(JSON.stringify(r))))).digest('hex').slice(0, 16);
const sum = (fn, out, threw) => threw ? 'threw' : fn === 'pdIntervals' ? 'intervals:' + out.map(i => i.used ? 'k' : (i.flags || []).join('+')).join(',') : out.state + (out.pick ? ':' + out.pick.mg : '');
for (const [fn, args] of fx) {
  let out, threw = null;
  try { out = sb[fn](...dec(args)); } catch (e) { threw = String(e.message); }
  console.log('    ' + JSON.stringify([sum(fn, out, threw), digest(threw ? { threw } : out)]) + ',');
}
