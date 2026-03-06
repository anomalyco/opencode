const fs = require('fs')
const path = require('path')

const root = process.cwd()
const base = path.join(root, 'test-results')
const dirs = ['reports','artifacts','triggers','logs','assets']
for (const d of dirs) {
  const p = path.join(base, d)
  try { fs.mkdirSync(p, { recursive: true }) } catch (e) {}
}
// create artifacts/run-archives if missing
try { fs.mkdirSync(path.join(base, 'artifacts', 'run-archives'), { recursive: true }) } catch (e) {}
console.log('Prepared test-results dirs')
