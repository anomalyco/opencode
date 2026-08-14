#!/usr/bin/env bun
/**
 * fork-verify — prove the fork's custom surface survived an upstream sync.
 *
 * Reads fork/manifest.json and checks that:
 *   - every `owned` file (fork-only, can't content-conflict but CAN be dropped
 *     during conflict resolution) still exists, and
 *   - every `patched` upstream file still exists AND still contains its marker
 *     string (the fingerprint of our edit).
 *
 * This is the safety net for the exact failure the fork keeps hitting: a patch
 * silently disappearing in a merge. Run it after every sync, before merging the
 * sync branch back into dev.
 *
 *   bun run fork:verify
 *
 * Exit codes: 0 = clean, 1 = a regression was introduced (or a known
 * regression is still outstanding when --strict is passed).
 */
import fs from "fs"
import path from "path"

const root = path.resolve(import.meta.dir, "..")
const strict = Bun.argv.includes("--strict")

type Patched = { file: string; marker: string; note?: string; status?: string }
type Divergence = { scope: string[]; accepted: string[]; note?: string }
type Manifest = {
  fork: string
  owned: string[]
  patched: Patched[]
  baseline: { upstreamRef: string }
  divergence?: Divergence
}

const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(root, "fork", "manifest.json"), "utf8"))

const missingOwned: string[] = []
const missingMarker: string[] = []
const knownRegressed: string[] = []

for (const rel of manifest.owned) {
  if (!fs.existsSync(path.join(root, rel))) missingOwned.push(rel)
}

for (const p of manifest.patched) {
  const abs = path.join(root, p.file)
  const exists = fs.existsSync(abs)
  const hasMarker = exists && fs.readFileSync(abs, "utf8").includes(p.marker)
  const isKnownRegression = typeof p.status === "string" && p.status.startsWith("REGRESSED")
  if (hasMarker) continue
  if (isKnownRegression) knownRegressed.push(`${p.file}  (marker "${p.marker}")`)
  else missingMarker.push(`${p.file}  (marker "${p.marker}"${exists ? "" : ", FILE MISSING"})`)
}

// --- divergence gate -------------------------------------------------------
// A file that differs from the upstream baseline is either a registered fork
// feature (owned/patched above), an accepted divergence, or drift. Drift is how
// the self-healing compaction feature was silently deleted by a merge and went
// unnoticed until a test that had never run finally ran.
//
// This is a ratchet, not a wall: the divergence that existed when the gate was
// added is recorded in `divergence.accepted`, and anything NEW fails. Re-baseline
// deliberately with `bun run fork:verify --accept-divergence` once you have
// classified the new files as feature (add to owned/patched) or drift (revert).
const accept = Bun.argv.includes("--accept-divergence")
const registered = new Set<string>([...manifest.owned, ...manifest.patched.map((p) => p.file)])
const divergence = manifest.divergence
let unregistered: string[] = []
let divergenceChecked = false

if (divergence) {
  const ref = manifest.baseline.upstreamRef
  const proc = Bun.spawnSync(["git", "diff", "--name-only", ref], { cwd: root })
  if (proc.exitCode === 0) {
    divergenceChecked = true
    const inScope = (f: string) => divergence.scope.some((g) => new RegExp(g).test(f))
    const accepted = new Set(divergence.accepted)
    unregistered = proc.stdout
      .toString()
      .split("\n")
      .filter(Boolean)
      .filter(inScope)
      .filter((f) => !registered.has(f) && !accepted.has(f))
      .sort()
  }
}

const line = (s: string) => process.stdout.write(s + "\n")
line(`fork-verify: ${manifest.fork}`)
line(`  owned files:   ${manifest.owned.length - missingOwned.length}/${manifest.owned.length} present`)
line(`  patched files: ${manifest.patched.length - missingMarker.length - knownRegressed.length}/${manifest.patched.length} intact`)

if (missingOwned.length) {
  line("\n✗ DROPPED owned files (fork features lost in merge):")
  for (const f of missingOwned) line(`    ${f}`)
}
if (missingMarker.length) {
  line("\n✗ LOST patch markers (custom edit reverted by merge):")
  for (const f of missingMarker) line(`    ${f}`)
}
if (knownRegressed.length) {
  line("\n⚠ known regressions still outstanding (flagged in manifest, re-apply when able):")
  for (const f of knownRegressed) line(`    ${f}`)
}

if (divergenceChecked && accept) {
  const proc = Bun.spawnSync(["git", "diff", "--name-only", manifest.baseline.upstreamRef], { cwd: root })
  const inScope = (f: string) => manifest.divergence!.scope.some((g) => new RegExp(g).test(f))
  const next = proc.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .filter(inScope)
    .filter((f) => !registered.has(f))
    .sort()
  manifest.divergence!.accepted = next
  fs.writeFileSync(path.join(root, "fork", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  line(`\nre-baselined divergence: ${next.length} accepted file(s)`)
  process.exit(0)
}

if (divergenceChecked) {
  line(`  divergence:    ${unregistered.length} unregistered (${manifest.divergence!.accepted.length} accepted)`)
}
if (unregistered.length) {
  line("\n✗ UNREGISTERED divergence from upstream (classify as feature or revert as drift):")
  for (const f of unregistered) line(`    ${f}`)
  line("  → a fork feature belongs in fork/manifest.json (owned or patched).")
  line("  → drift should be reverted to upstream.")
  line("  → if it is neither, re-baseline with: bun run fork:verify --accept-divergence")
}

const newRegressions = missingOwned.length + missingMarker.length + unregistered.length
if (newRegressions > 0) {
  line(`\nFAIL — ${newRegressions} new regression(s). Re-apply before merging the sync branch.`)
  process.exit(1)
}
if (strict && knownRegressed.length) {
  line(`\nFAIL (--strict) — ${knownRegressed.length} known regression(s) outstanding.`)
  process.exit(1)
}
line("\nOK — no new regressions." + (knownRegressed.length ? ` (${knownRegressed.length} known, non-blocking)` : ""))
process.exit(0)
