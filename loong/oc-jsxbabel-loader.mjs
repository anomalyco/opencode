import { fileURLToPath } from "node:url"
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import * as path from "node:path"

const require_ = createRequire("/home/Way-Kwok_Chu/jsx-babel/x.js")
const babel = require_("@babel/core")
const tsMod = require_("@babel/preset-typescript")
const solidMod = require_("babel-preset-solid")
const tsPreset = tsMod.default || tsMod
const solidPreset = solidMod.default || solidMod

const CACHE_DIR = process.env.JSX_CACHE_DIR || "/home/Way-Kwok_Chu/devel/opencode/loong/.jsx-cache"
try {
  mkdirSync(CACHE_DIR, { recursive: true })
} catch {}

function cachePaths(absPath) {
  const key = createHash("sha1").update(absPath).digest("hex")
  return {
    code: path.join(CACHE_DIR, key + (absPath.endsWith(".tsx") ? ".js" : ".mjs")),
    meta: path.join(CACHE_DIR, key + ".meta"),
  }
}

function walkFiles(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === ".tsbuild" || entry.name === "node_modules") continue
      walkFiles(p, out)
    } else if (entry.isFile() && /\.(tsx|ts)$/.test(entry.name)) {
      out.push(p)
    }
  }
  return out
}

async function transformToCache(absPath) {
  const st = statSync(absPath)
  const source = readFileSync(absPath, "utf8")
  const isTsx = absPath.endsWith(".tsx")
  const tsOpts = { allowDeclareFields: true }
  const presets = isTsx
    ? [
        [solidPreset, { moduleName: "@opentui/solid", generate: "universal" }],
        [tsPreset, tsOpts],
      ]
    : [[tsPreset, tsOpts]]
  const out = await babel.transformAsync(source, {
    filename: absPath,
    configFile: false,
    babelrc: false,
    presets,
  })
  const { code, meta } = cachePaths(absPath)
  writeFileSync(code, out.code, "utf8")
  writeFileSync(meta, String(st.mtimeMs), "utf8")
  return out.code
}

async function prewarm(dir) {
  if (!process.env.JSX_PREWARM || !dir) return
  process.stderr.write("[jsx-babel] prewarming " + dir + "\n")
  let n = 0
  for (const file of walkFiles(dir)) {
    const { code, meta } = cachePaths(file)
    try {
      if (existsSync(meta) && readFileSync(meta, "utf8").trim() === String(statSync(file).mtimeMs)) continue
      await transformToCache(file)
      n++
    } catch {}
  }
  process.stderr.write("[jsx-babel] prewarm done (+" + n + ")\n")
}

if (process.env.JSX_PREWARM) {
  await prewarm(process.env.JSX_PREWARM)
}

async function loadImpl(url, context, nextLoad) {
  if (!/\.tsx?$/.test(url)) return nextLoad(url, context)
  const absPath = fileURLToPath(url)
  if (!process.env.OC_LOADER_LOG) { /* silent */ }
  let st
  try {
    st = statSync(absPath)
  } catch {
    process.stderr.write("[jsx-babel] notstat " + url + "\n")
    return nextLoad(url, context)
  }
  const { code, meta } = cachePaths(absPath)
  if (existsSync(code) && existsSync(meta)) {
    try {
      if (readFileSync(meta, "utf8").trim() === String(st.mtimeMs)) {
        return { format: "module", shortCircuit: true, source: readFileSync(code, "utf8") }
      }
    } catch {}
  }
  try {
    const out = await transformToCache(absPath)
    return { format: "module", shortCircuit: true, source: out }
  } catch (e) {
    process.stderr.write("[jsx-babel] xform err " + url + " -> " + (e && e.message ? e.message : e) + "\n")
    return nextLoad(url, context)
  }
}

const _PROF = { resolve: 0, resolveMs: 0, load: 0, loadMs: 0 }
if (process.env.OC_PROFILE) {
  const dump = () => { try { writeFileSync("/tmp/prof-babel.json", JSON.stringify(_PROF)) } catch {} }
  setInterval(dump, 3000)
}
function _withProf(k, impl) {
  return async (...a) => {
    const t = Date.now()
    try { return await impl(...a) } finally {
      _PROF[k]++; _PROF[k + "Ms"] += Date.now() - t
    }
  }
}
export const load = _withProf("load", loadImpl)
