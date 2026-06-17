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
type Manifest = { fork: string; owned: string[]; patched: Patched[] }

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

const newRegressions = missingOwned.length + missingMarker.length
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
