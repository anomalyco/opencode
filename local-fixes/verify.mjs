#!/usr/bin/env bun
/**
 * fixes:verify — cheap pre-flight. No build, no writes, ~1s.
 *
 * Answers one question: is the currently staged binary a trustworthy build of
 * the fix, and will OpenChamber actually use it?
 *
 *   bun run fixes:verify
 */
import { spawnSync, execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs"
import { join, dirname, basename, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const manifest = JSON.parse(readFileSync(join(ROOT, "local-fixes/manifest.json"), "utf8"))
const fixes = manifest.fixes ?? (manifest.fix ? [manifest.fix] : [])
if (!fixes.length) throw new Error("manifest contains no local fixes")

function readPinnedBinary() {
  try {
    return execFileSync("powershell.exe", [
      "-NoProfile", "-Command",
      "[Environment]::GetEnvironmentVariable('OPENCODE_BINARY','User')",
    ], { encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

const pinnedBinary = readPinnedBinary()

/** Resolve the stage template to the binary OpenChamber will actually load:
 *  the pin target when it matches the template, else the newest versioned
 *  file on disk, else null. Versioned filenames exist because Windows locks
 *  the running binary, so each build stages to opencode-patched-<version>.exe. */
function resolveStagePath(template) {
  if (!template.includes("{version}")) return template
  const dir = dirname(template)
  const tbase = basename(template).split("{version}")
  const prefix = tbase[0]
  const suffix = tbase[1]
  const matches = (p) => basename(p).startsWith(prefix) && basename(p).endsWith(suffix)
  if (pinnedBinary && matches(pinnedBinary) && existsSync(pinnedBinary)) return pinnedBinary
  if (!existsSync(dir)) return null
  const ranked = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .map((f) => ({ f, v: /^(\d+)\.(\d+)\.(\d+)$/.exec(f.slice(prefix.length, suffix.length ? -suffix.length : undefined)) }))
    .filter((x) => x.v)
    .sort((a, b) => (a.v[1] - b.v[1]) || (a.v[2] - b.v[2]) || (a.v[3] - b.v[3]))
  if (!ranked.length) return null
  return join(dir, ranked[ranked.length - 1].f)
}

let bad = 0
const line = (mark, msg) => console.log(`  ${mark}  ${msg}`)
const good = (m) => line("ok  ", m)
const warn = (m) => { bad++; line("FAIL", m) }
const note = (m) => line("    ", m)

console.log(`\n=== fixes:verify — ${fixes.map((fix) => fix.id).join(", ")} ===`)

// 1. staged binary present
console.log(`\n[1] staged binary`)
const stagePath = resolveStagePath(manifest.stage.path)
if (!stagePath || !existsSync(stagePath)) {
  warn(`no staged binary for template: ${manifest.stage.path}`)
  note(`run \`bun run fixes:apply\` to build and stage it`)
  console.log(`\nNot trustworthy — the fix is not staged.\n`)
  process.exit(1)
}
const st = statSync(stagePath)
good(`${stagePath}`)
note(`${(st.size / 1048576).toFixed(1)} MB, modified ${st.mtime.toISOString().replace("T", " ").slice(0, 19)}`)

// 2. runtime version
console.log(`\n[2] runtime version`)
const vv = spawnSync(stagePath, ["--version"], { encoding: "utf8" })
const reported = (vv.stdout || "").trim()
if (!reported) {
  warn(`staged binary did not answer --version`)
} else if (/^0\.|dev|unknown/i.test(reported)) {
  warn(`reports "${reported}" — a dev/zero version breaks free-tier models with 426`)
} else {
  good(`reports ${reported}`)
}

// 3. markers inside the binary
console.log(`\n[3] fix markers inside the staged binary`)
const hay = readFileSync(stagePath).toString("latin1")
for (const fix of fixes) {
  for (const m of fix.markers) {
    if (hay.includes(m)) good(`${fix.id}: present: ${m}`)
    else warn(`MISSING (${fix.id}): ${m}`)
  }
}

// 3b. RUNNING binary is the staged build (2026-09-28: a launch loaded a stale
// stable-name exe while the env var was correctly set — verify what actually runs)
console.log(`\n[3b] running binary`)
try {
  const managedDir = process.env.USERPROFILE + "\\.config\\openchamber\\managed-opencode"
  const rec = readdirSync(managedDir).filter((f) => f.endsWith(".json"))
    .map((f) => [statSync(join(managedDir, f)).mtimeMs, f]).sort().map((s) => s[1]).at(-1)
  if (!rec) {
    note(`no managed-opencode record found`)
  } else {
    const recBinary = JSON.parse(readFileSync(join(managedDir, rec), "utf8")).binary
    const stagedHash = createHash("sha256").update(readFileSync(stagePath)).digest("hex")
    const check = (p, label) => {
      try {
        const h = createHash("sha256").update(readFileSync(p)).digest("hex")
        if (h === stagedHash) good(`${label} matches staged build: ${p}`)
        else warn(`${label} is a DIFFERENT build than staged (stale?): ${p}`)
      } catch { note(`${label} not found: ${p}`) }
    }
    if (recBinary) check(recBinary, `record ${rec} binary`)
    const stable = process.env.USERPROFILE + "\\.local\\bin\\opencode-patched.exe"
    if (existsSync(stable) && resolve(stable) !== resolve(stagePath)) check(stable, `stable-name exe`)
  }
} catch (e) { note(`running-binary check skipped: ${e.message}`) }

// 4. fix commits still in this repo
console.log(`\n[4] fix commits`)
for (const fix of fixes) {
  const has = spawnSync("git", ["cat-file", "-e", `${fix.commit}^{commit}`], { cwd: ROOT, encoding: "utf8" })
  if (has.status === 0) good(`${fix.id}: ${fix.commit.slice(0, 10)} present`)
  else warn(`${fix.id}: commit ${fix.commit.slice(0, 10)} not found — has it been dropped?`)
}

// 5. does the build branch for the reported version exist?
console.log(`\n[5] build branch for the staged version`)
const branch = `${manifest.buildBranchPrefix}${reported}`
const br = spawnSync("git", ["rev-parse", "--verify", branch], { cwd: ROOT, encoding: "utf8" })
if (br.status === 0) good(`${branch} exists`)
else note(`(no ${branch} — staged binary may predate this workflow, which is fine)`)

// 6. will OpenChamber use it?
// The pin that COUNTS is the environment variable. OpenChamber resolves its binary at
// startup as `process.env.OPENCODE_BINARY || searchPathFor('opencode')`, and it drops
// settings.json's opencodeBinary on every settings rewrite (verified 2026-09-25).
// Checking the settings file alone reports a pin that does not exist.
console.log(`\n[6] OpenChamber pin (OPENCODE_BINARY, User scope)`)
const pinned = pinnedBinary
if (!pinned) warn(`could not read the User environment — OpenChamber may use its BUNDLED binary, not this one`)
if (pinned === stagePath) good(`OPENCODE_BINARY (User) → staged binary`)
else if (!pinned) warn(`OPENCODE_BINARY (User) is empty — OpenChamber will use its BUNDLED binary, not this one`)
else warn(`OPENCODE_BINARY (User) points at "${pinned}" — NOT the staged binary`)

// settings.json is cosmetic UI state; report it, never trust it
const settingsFile = manifest.stage.settingsFile
if (existsSync(settingsFile)) {
  try {
    const s = JSON.parse(readFileSync(settingsFile, "utf8"))
    const ui = s[manifest.stage.settingsKey]
    if (ui === stagePath) note(`(settings.json ${manifest.stage.settingsKey} matches — cosmetic, dropped on rewrite)`)
    else note(`(settings.json ${manifest.stage.settingsKey} is ${ui ? `"${ui}"` : "empty"} — cosmetic only, not read at startup)`)
  } catch (e) {
    note(`(could not read ${settingsFile}: ${e.message})`)
  }
}

console.log(
  bad === 0
    ? `\nStaged binary is trustworthy: the fix is present and OpenChamber is pinned to it.\n`
    : `\n${bad} problem(s) found — do not restart on this build.\n`,
)
process.exit(bad === 0 ? 0 : 1)
