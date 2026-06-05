#!/usr/bin/env bun

// Cross-compile the SecureCode supervisor (`securecode` in the final archive)
// for every platform that `packages/opencode/script/build.ts` produced. The
// supervisor is the sandbox launcher that spawns opencode (`securecode-bin`)
// inside a sandbox at runtime — both binaries ship side-by-side in each
// platform archive.
//
// This script was split out from script/release-securecode.ts so that build
// (Linux runner) and codesign+release (macOS runner) can live in separate
// CI jobs. Without the split, the macOS release job would have to also
// cross-compile the supervisor for every platform, which is wasteful and
// blurs the runner's responsibility. Refs
// https://github.com/acompany-develop/securecode/issues/294.

import { $ } from "bun"
import fs from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const dist = path.join(root, "packages", "opencode", "dist")
const supervisorEntry = path.join(root, "script", "securecode-supervisor.ts")

let built = 0
for (const dir of await fs.readdir(dist, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  if (!dir.name.startsWith("opencode-")) continue
  if (dir.name.includes("windows")) continue

  // The pre-built opencode binary must already exist (build.ts ran first);
  // skip empty / partial dist dirs left over from previous runs.
  const innerBin = path.join(dist, dir.name, "bin", "opencode")
  if (!(await exists(innerBin))) continue

  const platformSuffix = dir.name.replace(/^opencode-/, "")
  const bunTarget = `bun-${platformSuffix}`
  const out = path.join(dist, dir.name, "bin", "securecode")

  console.log(`Building supervisor for ${platformSuffix} -> ${out}`)
  await $`bun build --compile --target=${bunTarget} ${supervisorEntry} --outfile ${out}`.cwd(root)
  await fs.chmod(out, 0o755)
  built++
}

if (built === 0) {
  throw new Error("No opencode binaries found in packages/opencode/dist. Did packages/opencode/script/build.ts run first?")
}

async function exists(file: string) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}
