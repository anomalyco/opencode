const fs = require('fs');
const path = require('path');

const indexJs =
  process.env['DIST_PATH'] ?
    path.resolve(process.env['DIST_PATH'], 'index.js')
  : path.resolve(__dirname, '..', '..', 'dist', 'index.js');

let before = fs.readFileSync(indexJs, 'utf8');
let after = before.replace(
  /^(\s*Object\.defineProperty\s*\(exports,\s*["']__esModule["'].+)$/m,
  `exports = module.exports = function (...args) {
    return new exports.default(...args)
  }
  $1`.replace(/^  /gm, ''),
);
fs.writeFileSync(indexJs, after, 'utf8');
