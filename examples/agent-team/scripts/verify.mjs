#!/usr/bin/env node
// Dependency-free static validator for the agent-team bundle.
// Run from anywhere: `node scripts/verify.mjs` or `bun scripts/verify.mjs`.
// Exits non-zero if any check fails.

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..") // examples/agent-team
const agentDir = join(root, ".opencode", "agent")
const configPath = join(root, ".opencode", "opencode.jsonc")

const ok = []
const errors = []
const pass = (m) => ok.push(m)
const fail = (m) => errors.push(m)

// --- string-aware JSONC -> JSON (handles // inside strings like "https://...") ---
function stripJsonc(src) {
  let out = ""
  let inStr = false
  let quote = ""
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const next = src[i + 1]
    if (inStr) {
      out += c
      if (c === "\\") {
        out += next ?? ""
        i++
      } else if (c === quote) {
        inStr = false
      }
      continue
    }
    if (c === '"' || c === "'") {
      inStr = true
      quote = c
      out += c
      continue
    }
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (c === "/" && next === "*") {
      i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++
      i++ // skip the closing '/'
      continue
    }
    out += c
  }
  return out.replace(/,(\s*[}\]])/g, "$1") // drop trailing commas
}

// --- minimal top-level YAML frontmatter parser (good enough for our fields) ---
function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return null
  const data = {}
  for (const raw of m[1].split("\n")) {
    if (/^\s/.test(raw)) continue // skip nested (tools:, permission:, ...)
    const kv = raw.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!kv) continue
    let v = kv[2].trim().replace(/^["']|["']$/g, "")
    if (v === "true") v = true
    else if (v === "false") v = false
    data[kv[1]] = v
  }
  return { data, body: m[2] }
}

// 1. opencode.jsonc
let config
try {
  config = JSON.parse(stripJsonc(readFileSync(configPath, "utf8")))
  pass("opencode.jsonc parses")
  if (typeof config.default_agent !== "string") fail("default_agent must be a string")
  else pass(`default_agent = "${config.default_agent}"`)
} catch (e) {
  fail(`opencode.jsonc failed to parse: ${e.message}`)
}

// 2. agent frontmatter
const MODES = new Set(["primary", "subagent", "all"])
const agents = {}
if (!existsSync(agentDir)) {
  fail(`agent directory not found: ${agentDir}`)
} else {
  for (const file of readdirSync(agentDir).filter((f) => f.endsWith(".md"))) {
    const parsed = parseFrontmatter(readFileSync(join(agentDir, file), "utf8"))
    if (!parsed) {
      fail(`${file}: missing or malformed frontmatter`)
      continue
    }
    const { data, body } = parsed
    agents[file.replace(/\.md$/, "")] = data
    const before = errors.length
    if (!MODES.has(data.mode)) fail(`${file}: mode must be primary|subagent|all (got ${JSON.stringify(data.mode)})`)
    if (data.mode === "subagent" && data.hidden !== true) fail(`${file}: subagent must set 'hidden: true'`)
    if (!body || !body.trim()) fail(`${file}: empty prompt body`)
    if (errors.length === before) pass(`${file}: frontmatter ok (mode=${data.mode})`)
  }
}

// 3. default_agent resolves to a primary agent
if (config && typeof config.default_agent === "string") {
  const da = agents[config.default_agent]
  if (!da) fail(`default_agent "${config.default_agent}" has no matching agent file`)
  else if (da.mode !== "primary") fail(`default_agent "${config.default_agent}" must be mode: primary`)
  else pass("default_agent resolves to a primary agent")
}

// 4. inline-secret scan
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["']?[A-Za-z0-9_-]{12,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      scan(p)
    } else if (/\.(?:md|jsonc|json|mjs|js|ts|txt|ya?ml)$/.test(entry.name)) {
      const text = readFileSync(p, "utf8")
      for (const re of SECRET_PATTERNS) {
        if (re.test(text)) fail(`possible inline secret in ${p.replace(root + "/", "")} (matched ${re})`)
      }
    }
  }
}
scan(root)
if (!errors.some((e) => e.includes("secret"))) pass("no inline secrets detected")

// --- report ---
for (const m of ok) console.log(`  ok    ${m}`)
if (errors.length) {
  console.error("\nFAIL:")
  for (const m of errors) console.error(`  x     ${m}`)
  console.error(`\n${errors.length} problem(s) found.`)
  process.exit(1)
}
console.log("\nAll static checks passed.")
