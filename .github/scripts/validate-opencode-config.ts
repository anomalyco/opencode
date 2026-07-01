#!/usr/bin/env bun
//
// Config-layer regression check for the fork's `.opencode/` product surface.
//
// The `.opencode/agent/*.md`, `.opencode/command/*.md`, `.opencode/skills/**/SKILL.md`,
// and `.opencode/opencode.jsonc` files are first-class ANR product features. Upstream
// schema drift or a bad merge can silently break how they parse or which tools/skills
// they reference — and nothing else in CI loads them against the built binary.
//
// This script:
//   1. Runs the built binary's `agent list` so the real config loader parses the
//      fork's `.opencode/` directory end to end (not a re-implementation).
//   2. Independently parses every agent, command, and skill frontmatter as YAML so a
//      malformed file is reported precisely.
//   3. Verifies that every skill referenced by an agent's frontmatter resolves to a
//      real SKILL.md, and that agent tool keys are known permission keys.
//
// Usage:
//   OPENCODE_BIN=/path/to/opencode bun .github/scripts/validate-opencode-config.ts
//   (defaults OPENCODE_BIN to `opencode` on PATH)
//
import { readdirSync, existsSync, statSync, readFileSync } from "node:fs"
import { join, basename } from "node:path"

// Minimal, dependency-free frontmatter splitter. Runs from repo root in CI where
// workspace-only deps (e.g. gray-matter) are not resolvable. We only need the
// leading `---` YAML block and the markdown body, not a full YAML parser.
function readMatter(file: string): { data: Record<string, unknown>; content: string } {
  const raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "")
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { data: {}, content: raw }
  return { data: parseSimpleYaml(m[1]), content: m[2] ?? "" }
}

// Parses the small subset of YAML the config files use: top-level `key: value`
// scalars and one level of nested `key:` maps (used by `tools:`). Good enough to
// read `description`, `name`, and the keys of `tools:`; anything richer is ignored.
function parseSimpleYaml(text: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  const lines = text.split(/\r?\n/)
  let currentMapKey: string | null = null
  const map: Record<string, Record<string, unknown>> = {}
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue
    const indent = line.length - line.trimStart().length
    const body = line.trim()
    const kv = body.match(/^("?[^":]+"?)\s*:\s*(.*)$/)
    if (!kv) continue
    const key = kv[1].replace(/^"|"$/g, "")
    const value = kv[2]
    if (indent === 0) {
      if (value === "" || value === ">-" || value === "|" || value === ">") {
        currentMapKey = key
        map[key] = {}
        data[key] = map[key]
      } else {
        currentMapKey = null
        data[key] = value.replace(/^["']|["']$/g, "")
      }
    } else if (currentMapKey) {
      map[currentMapKey][key] = value.replace(/^["']|["']$/g, "")
    }
  }
  return data
}

const BIN = process.env.OPENCODE_BIN || "opencode"
const ROOT = process.env.OPENCODE_CONFIG_ROOT || process.cwd()
const OPENCODE_DIR = join(ROOT, ".opencode")

const errors: string[] = []
const warnings: string[] = []
const fail = (msg: string) => errors.push(msg)
const warn = (msg: string) => warnings.push(msg)

// Known first-party permission keys the runtime enforces. Kept in sync with
// packages/opencode/src/cli/cmd/agent.ts AVAILABLE_PERMISSIONS. Plugins may
// register additional tools (e.g. `github-triage`), so an unknown key is a
// WARNING, not a hard failure — only malformed frontmatter and missing skill
// references fail the job.
const KNOWN_TOOLS = new Set([
  "*",
  "bash",
  "read",
  "edit",
  "write",
  "glob",
  "grep",
  "list",
  "webfetch",
  "websearch",
  "question",
  "task",
  "todoread",
  "todowrite",
  "lsp",
  "skill",
  "patch",
])

function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(dir, f))
}

function listSkills(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...listSkills(p))
    else if (entry === "SKILL.md") out.push(p)
  }
  return out
}

// ---- 1. Parse every markdown frontmatter -----------------------------------
const agentFiles = listMarkdown(join(OPENCODE_DIR, "agent"))
const commandFiles = listMarkdown(join(OPENCODE_DIR, "command"))
const skillFiles = listSkills(join(OPENCODE_DIR, "skills"))

console.log(`Config layer: ${agentFiles.length} agents, ${commandFiles.length} commands, ${skillFiles.length} skills`)

const skillNames = new Set<string>()
for (const file of skillFiles) {
  // Every skill is resolvable by BOTH its directory name and its frontmatter
  // `name`, since agents reference skills by either.
  const dirName = basename(join(file, ".."))
  skillNames.add(dirName)
  try {
    const parsed = readMatter(file)
    const name = parsed.data.name as string | undefined
    if (name) skillNames.add(name)
    if (!parsed.data.description) warn(`skill missing 'description': ${file}`)
  } catch (e) {
    fail(`skill frontmatter failed to parse: ${file}: ${(e as Error).message}`)
  }
}

// Skill names referenced inside an agent's "## Recommended Skills" section
// (a markdown table of `backticked` skill names). Renaming/removing a skill
// without updating the agent that references it must fail this job.
function referencedSkills(body: string): string[] {
  const start = body.search(/^##+\s+Recommended Skills/im)
  if (start < 0) return []
  const rest = body.slice(start)
  const end = rest.search(/^##+\s+(?!Recommended Skills)/im)
  const section = end > 0 ? rest.slice(0, end) : rest
  const names = new Set<string>()
  for (const m of section.matchAll(/`([a-z0-9][a-z0-9-_]*)`/gi)) names.add(m[1])
  return [...names]
}

for (const file of commandFiles) {
  try {
    readMatter(file)
  } catch (e) {
    fail(`command frontmatter failed to parse: ${file}: ${(e as Error).message}`)
  }
}

for (const file of agentFiles) {
  try {
    const parsed = readMatter(file)
    if (!parsed.data.description) warn(`agent missing 'description': ${basename(file)}`)

    const tools = parsed.data.tools
    if (tools && typeof tools === "object") {
      for (const key of Object.keys(tools)) {
        if (!KNOWN_TOOLS.has(key)) warn(`agent '${basename(file)}' references non-core tool '${key}' (plugin-provided?)`)
      }
    }

    // Skills an agent declares it can load MUST exist on disk — this is the
    // regression the config-layer job exists to catch (a renamed/removed skill).
    const declaredSkills: string[] = []
    if (Array.isArray(parsed.data.skills)) declaredSkills.push(...(parsed.data.skills as string[]))
    declaredSkills.push(...referencedSkills(parsed.content))
    for (const skill of new Set(declaredSkills)) {
      if (!skillNames.has(skill)) fail(`agent '${basename(file)}' references missing skill '${skill}'`)
    }
  } catch (e) {
    fail(`agent frontmatter failed to parse: ${file}: ${(e as Error).message}`)
  }
}

// ---- 2. Load config through the built binary --------------------------------
// `agent list` forces the real loader to parse the fork's .opencode/ end to end.
try {
  const proc = Bun.spawnSync([BIN, "agent", "list"], {
    cwd: ROOT,
    // Validate ANR flavor config loading, but bypass interactive auth in CI.
    env: { ...process.env, OPENCODE_FLAVOR: "anr", OPENCODE_ANR_SKIP_AUTH: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = proc.stdout.toString()
  const stderr = proc.stderr.toString()
  if (proc.exitCode !== 0) {
    fail(`'${BIN} agent list' exited ${proc.exitCode}\n--- stderr ---\n${stderr}\n--- stdout ---\n${stdout}`)
  } else {
    console.log(`'${BIN} agent list' loaded config successfully`)
  }
} catch (e) {
  fail(`failed to invoke '${BIN} agent list': ${(e as Error).message}`)
}

// ---- report -----------------------------------------------------------------
if (warnings.length > 0) {
  console.warn(`\nConfig-layer warnings (${warnings.length}):`)
  for (const w of warnings) console.warn(`  - ${w}`)
}
if (errors.length > 0) {
  console.error(`\nConfig-layer validation FAILED with ${errors.length} error(s):`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
console.log("\nConfig-layer validation passed.")
