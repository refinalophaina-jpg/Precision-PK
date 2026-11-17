// require(load.cjs)(repo, htmlPath) -> the phase2d sandbox with that html loaded, no tests run.
const fs = require('fs'), path = require('path'), Module = require('module');
module.exports = (repo, htmlPath) => {
  const file = path.join(repo, 'phase2d_validation.cjs');
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace("const htmlPath = path.join(__dirname, 'index.html');", `const htmlPath = ${JSON.stringify(htmlPath)};`);
  src = src.replace('// ─── 3. Test framework ', 'module.exports = sandbox; return;\n// ');
  const m = new Module(file, null); m.filename = file; m.paths = Module._nodeModulePaths(repo);
  m._compile(src, file); return m.exports;
};
