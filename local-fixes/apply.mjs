#!/usr/bin/env bun
/**
 * fixes:apply — upgrade the patched opencode binary to a newer upstream tag,
 * re-applying our compaction-anchor fix, then verify it survived bundling
 * before staging it for OpenChamber.
 *
 *   bun run fixes:apply              # newest upstream v1.x tag
 *   bun run fixes:apply v1.18.33     # a specific tag
 *   bun run fixes:apply 1.18.33      # same, without the v
 *
 * The fix commit is IMMUTABLE. Every run creates a fresh build/<version>
 * branch from the target tag and cherry-picks the fix onto it, so an upgrade
 * can never rewrite or lose the fix, and a failed upgrade leaves the repo
 * exactly as it was found.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, copyFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const manifest = JSON.parse(readFileSync(join(ROOT, "local-fixes/manifest.json"), "utf8"))

let step = 0
const ok = (m) => console.log(`  ok    ${m}`)
const info = (m) => console.log(`        ${m}`)
const fail = (m) => {
  console.error(`\nFAILED: ${m}`)
  process.exit(2)
}

function git(args, opts = {}) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", ...opts })
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() }
}
function gitOrFail(args, what) {
  const r = git(args)
  if (r.code !== 0) fail(`${what}\n  git ${args.join(" ")}\n  ${r.err || r.out}`)
  return r.out
}

/** v1.18.32 -> [1,18,32]; returns null for anything not a plain v1.x.y tag */
function parseTag(tag) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2])

function newestV1Tag() {
  const tags = gitOrFail(["tag", "--list", "v1.*"], "listing tags").split("\n").filter(Boolean)
  const ranked = tags.map((t) => ({ t, v: parseTag(t) })).filter((x) => x.v).sort((a, b) => cmp(a.v, b.v))
  if (!ranked.length) fail("no v1.x.y tags found upstream")
  return ranked[ranked.length - 1].t
}

/** bytes contain the marker as a literal substring (bundled JS is utf8) */
function binaryHasMarkers(file, markers) {
  const buf = readFileSync(file)
  const hay = buf.toString("latin1")
  return markers.map((m) => ({ marker: m, found: hay.includes(m) }))
}

console.log(`\n=== fixes:apply — opencode ${manifest.fix.id} ===`)
const fix = manifest.fix
const startBranch = gitOrFail(["branch", "--show-current"], "reading current branch")

// ---------------------------------------------------------------- 1. resolve target
step++
console.log(`\n[${step}] resolve target version`)
const arg = process.argv[2]
let tag
if (arg) {
  tag = arg.startsWith("v") ? arg : `v${arg}`
} else {
  gitOrFail(["fetch", "origin", "--tags", "--quiet"], "fetching upstream tags")
  tag = newestV1Tag()
  info("no version given — using newest upstream v1.x tag")
}
const v = parseTag(tag)
if (!v) fail(`not a plain vX.Y.Z tag: ${tag}`)
if (v[0] !== 1) {
  fail(
    `refusing to target ${tag}: this repo only supports OpenCode v1.x.\n` +
      `  ${manifest.upstreamConstraint}`,
  )
}
const version = `${v[0]}.${v[1]}.${v[2]}`
ok(`target ${tag} (version ${version})`)

// ---------------------------------------------------------------- 2. preflight
step++
console.log(`\n[${step}] preflight`)
if (git(["cat-file", "-e", `${tag}^{commit}`]).code !== 0) {
  // the tag may not be fetched yet when an explicit version was passed
  gitOrFail(["fetch", "origin", "--tags", "--quiet"], "fetching upstream tags")
}
if (git(["cat-file", "-e", `${tag}^{commit}`]).code !== 0) fail(`tag does not exist: ${tag}`)
if (git(["cat-file", "-e", `${fix.commit}^{commit}`]).code !== 0) {
  fail(`fix commit is missing from this repo: ${fix.commit}`)
}
ok(`fix commit present: ${fix.commit.slice(0, 10)}`)

const dirty = git(["status", "--porcelain"])
  .out.split("\n")
  .filter(Boolean)
  // build output is regenerated on every run; anything else is real work
  .filter((l) => !/(^|[\s/])dist\//.test(l))
if (dirty.length) {
  fail(`working tree has changes beyond build output:\n${dirty.map((l) => "  " + l).join("\n")}\n  commit or stash them, then re-run.`)
}
ok("working tree clean")

// ---------------------------------------------------------------- 3. build branch
step++
console.log(`\n[${step}] create build branch from ${tag}`)
const buildBranch = `${manifest.buildBranchPrefix}${version}`
gitOrFail(["checkout", "-B", buildBranch, tag], `creating ${buildBranch}`)
ok(`on ${buildBranch}`)

// ---------------------------------------------------------------- 4. re-apply the fix
step++
console.log(`\n[${step}] re-apply the fix`)
let applied = false
const cp = git(["cherry-pick", "--no-gpg-sign", fix.commit])
if (cp.code === 0) {
  ok("cherry-pick clean")
  applied = true
} else {
  git(["cherry-pick", "--abort"])
  info("cherry-pick conflicted — trying the patch with 3-way merge")
  const patchPath = join(ROOT, fix.patch)
  if (!existsSync(patchPath)) {
    gitOrFail(["checkout", startBranch], "restoring branch")
    fail(`both cherry-pick and patch failed, and ${fix.patch} does not exist. Upstream moved the same code — resolve by hand.`)
  }
  const ap = git(["apply", "--3way", patchPath])
  if (ap.code === 0) {
    gitOrFail(["add", "-A"], "staging patched files")
    const c = git(["commit", "-q", "--no-gpg-sign", "-m", `${fix.title} (patch application)`])
    if (c.code !== 0) {
      gitOrFail(["checkout", startBranch], "restoring branch")
      fail("patch applied but commit failed")
    }
    ok("patch applied with 3-way merge")
    applied = true
  }
}

if (!applied) {
  git(["checkout", "--", "."])
  git(["checkout", startBranch], "restoring branch")
  fail(
    `CONFLICT: upstream moved the same code as the fix at ${tag}.\n` +
      `  Nothing was changed — you are back on ${startBranch}.\n` +
      `  Rebase ${fix.commit.slice(0, 10)} by hand, then update manifest.fix.commit.`,
  )
}

// ---------------------------------------------------------------- 5. build
step++
console.log(`\n[${step}] build with OPENCODE_VERSION=${version}`)
const buildDir = join(ROOT, manifest.build.cwd)
const b = spawnSync("bun", ["run", "script/build.ts", "--single", "--skip-embed-web-ui", "--skip-install"], {
  cwd: buildDir,
  encoding: "utf8",
  env: { ...process.env, [manifest.build.versionEnv]: version },
  stdio: ["ignore", "pipe", "pipe"],
})
if (b.status !== 0) {
  console.error(b.stdout?.slice(-2000) || "")
  console.error(b.stderr?.slice(-2000) || "")
  gitOrFail(["checkout", startBranch], "restoring branch")
  fail(`build failed (exit ${b.status})`)
}
ok("build succeeded")

const artifact = join(ROOT, manifest.build.cwd, manifest.build.artifact)
if (!existsSync(artifact)) fail(`built artifact missing: ${artifact}`)

// ---------------------------------------------------------------- 6. run the fix's tests
step++
console.log(`\n[${step}] run ${fix.tests}`)
const t = spawnSync("bun", ["test", `test/${fix.tests.replace(/^test\//, "")}`, "--timeout", "30000"], {
  cwd: buildDir,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
})
const tOut = `${t.stdout || ""}\n${t.stderr || ""}`
const countOf = (word) => {
  const m = tOut.match(new RegExp(`^\\s*(\\d+) ${word}\\s*$`, "m"))
  return m ? Number(m[1]) : 0
}
const passed = countOf("pass")
const skipped = countOf("skip")
const failed = countOf("fail")
info(`${passed} pass, ${skipped} skip, ${failed} fail`)
if (t.status !== 0 || failed > 0 || passed === 0) {
  console.error(tOut.slice(-4000))
  gitOrFail(["checkout", startBranch], "restoring branch")
  fail("the fix's tests did not pass on this base — refusing to stage a binary")
}
ok("tests pass")

// ---------------------------------------------------------------- 7. verify markers in the artifact
step++
console.log(`\n[${step}] verify fix markers inside the built binary`)
const results = binaryHasMarkers(artifact, fix.markers)
for (const r of results) {
  if (r.found) ok(`marker present: ${r.marker}`)
  else console.error(`        MISSING: ${r.marker}`)
}
const missing = results.filter((r) => !r.found)
if (missing.length) {
  gitOrFail(["checkout", startBranch], "restoring branch")
  fail(`binary is missing ${missing.length} marker(s) — the fix did not survive bundling. Not staging.`)
}

// ---------------------------------------------------------------- 8. stage
step++
console.log(`\n[${step}] stage the binary`)
const stagePath = manifest.stage.path
copyFileSync(artifact, stagePath)
ok(`copied → ${stagePath}`)

const vv = spawnSync(stagePath, ["--version"], { encoding: "utf8" })
const reported = (vv.stdout || "").trim()
if (reported !== version) {
  fail(`staged binary reports "${reported}" but ${version} was expected.\n  If it says 0.x or a dev string, the OPENCODE_VERSION build env was lost.`)
}
ok(`staged binary reports ${reported}`)

// ---------------------------------------------------------------- 9. settings check
step++
console.log(`\n[${step}] check OpenChamber pin`)
const settingsFile = manifest.stage.settingsFile
if (existsSync(settingsFile)) {
  try {
    const s = JSON.parse(readFileSync(settingsFile, "utf8"))
    const pinned = s[manifest.stage.settingsKey]
    if (pinned === stagePath) ok(`settings.json ${manifest.stage.settingsKey} → staged binary`)
    else
      console.error(
        `        WARNING: settings.json points at "${pinned || "(bundled)"}"\n` +
          `        set  "${manifest.stage.settingsKey}": "${stagePath.replace(/\\/g, "\\\\")}"\n` +
          `        while OpenChamber is CLOSED, or the new binary will not be used.`,
      )
  } catch (e) {
    console.error(`        WARNING: could not read ${settingsFile}: ${e.message}`)
  }
} else {
  info(`(no settings file at ${settingsFile})`)
}

// ---------------------------------------------------------------- 10. restore branch
step++
console.log(`\n[${step}] restore working branch`)
gitOrFail(["checkout", startBranch], `returning to ${startBranch}`)
ok(`back on ${startBranch} (build kept on ${buildBranch} for inspection)`)

console.log(`\nAll steps passed. ${manifest.fix.id} is applied and verified for opencode ${version}.`)
console.log(`${manifest.restartNote}`)
console.log(`Rollback: \`bun run fixes:apply ${fix.base}\`, or delete ${stagePath} to fall back to the bundled binary.`)
