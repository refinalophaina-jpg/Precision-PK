// node encode.cjs cap.json -> prints fixture JSON (times as "@d|HH:MM") and stats. Run with TZ=America/Chicago.
const c = require(require('path').resolve(process.argv[2]));
const H = (d, hm) => { const [h, m] = hm.split(':').map(Number); return new Date(2026, 5, 10 + d, h, m).getTime() / 3600000; };
const base = new Date(2026, 5, 10, 0, 0);
let inexact = 0;
const enc = (v) => {
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
  if (typeof v === 'number' && v > 1e5) {
    const dt = new Date(v * 3600000);
    const d = Math.round((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) - base) / 86400000);
    const hm = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
    if (H(d, hm) === v) return '@' + d + '|' + hm;
    inexact++; return v;
  }
  return v;
};
const fx = c.map(r => [r.fn, enc(r.args)]);
const s = JSON.stringify(fx);
console.error('calls', fx.length, 'bytes', s.length, 'inexact', inexact);
process.stdout.write(s);
