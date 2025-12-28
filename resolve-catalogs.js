import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const projectRoot = __dirname
const rootPackagePath = path.join(projectRoot, 'package.json')

const HARDCODED_CATALOG = {
  "@types/bun": "1.3.4",
  "@octokit/rest": "22.0.0",
  "@hono/zod-validator": "0.4.2",
  "ulid": "3.0.1",
  "@kobalte/core": "0.13.11",
  "@types/luxon": "3.7.1",
  "@types/node": "22.13.9",
  "@tsconfig/node22": "22.0.2",
  "@tsconfig/bun": "1.0.9",
  "@cloudflare/workers-types": "4.20251008.0",
  "@openauthjs/openauth": "0.0.0-20250322224806",
  "@pierre/diffs": "1.0.0-beta.3",
  "@solid-primitives/storage": "4.3.3",
  "@tailwindcss/vite": "4.1.11",
  "diff": "8.0.2",
  "ai": "5.0.97",
  "hono": "4.10.7",
  "hono-openapi": "1.1.2",
  "fuzzysort": "3.1.0",
  "luxon": "3.6.1",
  "typescript": "5.8.2",
  "@typescript/native-preview": "7.0.0-dev.20251207.1",
  "zod": "4.1.8",
  "remeda": "2.26.0",
  "solid-list": "0.3.0",
  "tailwindcss": "4.1.11",
  "virtua": "0.42.3",
  "vite": "7.1.4",
  "@solidjs/meta": "0.29.4",
  "@solidjs/router": "0.15.4",
  "@solidjs/start": "1.0.11",
  "solid-js": "1.9.10",
  "vite-plugin-solid": "2.11.10",
  "@standard-community/standard-json": "0.3.5",
  "@standard-community/standard-openapi": "0.2.9",
  "quansync": "1.0.0"
}

function resolvePackageJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return
    console.log(`Processing ${path.relative(projectRoot, filePath)}...`)
    let content = fs.readFileSync(filePath, 'utf8')
    let pkg = JSON.parse(content)

    let changed = false

    const resolveObj = (obj) => {
      if (!obj || typeof obj !== 'object') return
      for (const [name, version] of Object.entries(obj)) {
        if (typeof version === 'string') {
          // Prune platform-specific watchers
          if (name.startsWith('@parcel/watcher-')) {
            const isWin = name.includes('win32')
            const isDarwin = name.includes('darwin')
            const isLinux = name.includes('linux')

            if ((process.platform === 'win32' && !isWin) ||
              (process.platform === 'darwin' && !isDarwin) ||
              (process.platform === 'linux' && !isLinux)) {
              delete obj[name]
              changed = true
              continue
            }
          }

          if (version === 'catalog:') {
            if (HARDCODED_CATALOG[name]) {
              obj[name] = HARDCODED_CATALOG[name]
              changed = true
            }
          } else if (version.startsWith('workspace:')) {
            obj[name] = '*'
            changed = true
          } else if (version.includes('pkg.pr.new/@solidjs/start') || version === '0.10.12') {
            obj[name] = HARDCODED_CATALOG['@solidjs/start'] || '1.0.11'
            changed = true
          } else if (version === '1.0.0' && name.startsWith('@standard-community/')) {
            obj[name] = HARDCODED_CATALOG[name]
            changed = true
          }
        } else if (typeof version === 'object') {
          resolveObj(version)
        }
      }
    }

    resolveObj(pkg.dependencies)
    resolveObj(pkg.devDependencies)
    resolveObj(pkg.peerDependencies)
    resolveObj(pkg.optionalDependencies)
    resolveObj(pkg.overrides)
    resolveObj(pkg.resolutions)

    // Relax engine requirements unconditionally to match user's Node 20.18.0
    if (!pkg.engines || pkg.engines.node !== ">=20.0.0") {
      pkg.engines = { "node": ">=20.0.0" }
      changed = true
    }

    // Fix packageManager to match user's environment
    if (pkg.packageManager !== 'npm@10.8.2') {
      pkg.packageManager = 'npm@10.8.2'
      changed = true
    }

    if (changed) {
      fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n')
      console.log(`  Resolved.`)
    }
  } catch (err) {
    console.error(`  Error processing ${filePath}: ${err.message}`)
  }
}

function findPackageJsons(dir, results = []) {
  try {
    const files = fs.readdirSync(dir)
    for (const file of files) {
      if (file === 'node_modules' || file === '.git' || file === '.opendeepseek' || file === 'dist' || file === 'src-tauri') continue
      const fullPath = path.join(dir, file)
      let stat
      try { stat = fs.statSync(fullPath) } catch (e) { continue }
      if (stat.isDirectory()) {
        findPackageJsons(fullPath, results)
      } else if (file === 'package.json') {
        results.push(fullPath)
      }
    }
  } catch (err) { }
  return results
}

console.log('NPM Compatibility Check Start...')
const allPackageJsons = findPackageJsons(projectRoot)
allPackageJsons.forEach(resolvePackageJson)
console.log('NPM Compatibility Check Complete.')
