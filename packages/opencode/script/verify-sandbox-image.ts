#!/usr/bin/env bun
// Vercel sandbox image sanity check. Given VERCEL_SANDBOX_IMAGE_ID,
// creates a throwaway sandbox, confirms every binary our L4 services
// need is on PATH, runs --version on each, and stops the sandbox.
// Exits 0 on success, 1 on any missing binary or failing smoke.

import { Sandbox } from "@vercel/sandbox"

const token = process.env["VERCEL_TOKEN"]
const teamId = process.env["VERCEL_TEAM_ID"]
const projectId = process.env["VERCEL_PROJECT_ID"]
const snapshotId = process.env["VERCEL_SANDBOX_IMAGE_ID"]

if (!token || !teamId || !projectId || !snapshotId) {
  console.error("missing VERCEL_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID / VERCEL_SANDBOX_IMAGE_ID")
  process.exit(2)
}

const REQUIRED = [
  "git",
  "prettier",
  "gofmt",
  "rustfmt",
  "black",
  "shfmt",
  "rg",
  "typescript-language-server",
  "pyright",
  "gopls",
  "rust-analyzer",
  "bash",
  "sh",
  "node",
  "npm",
  "python3",
  "go",
  "stat",
  "find",
  "curl",
]

const SMOKES: Array<[string, string[]]> = [
  ["git", ["--version"]],
  ["prettier", ["--version"]],
  ["rg", ["--version"]],
  ["typescript-language-server", ["--version"]],
  ["pyright", ["--version"]],
  ["gopls", ["version"]],
  ["rust-analyzer", ["--version"]],
  ["black", ["--version"]],
  ["shfmt", ["--version"]],
]

let sandbox: Sandbox | null = null
let failures = 0

try {
  console.log(`[verify] creating sandbox from ${snapshotId}`)
  sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId },
    token,
    teamId,
    projectId,
    timeout: 10 * 60 * 1000,
  } as Parameters<typeof Sandbox.create>[0])
  console.log(`[verify] sandbox ${sandbox.name} ready`)

  console.log("\n[verify] checking binary presence:")
  for (const bin of REQUIRED) {
    const r = await sandbox.runCommand("sh", ["-c", `command -v ${bin}`])
    const out = (await r.stdout()).trim()
    if (r.exitCode !== 0 || !out) {
      console.error(`  ✗ ${bin} — NOT FOUND`)
      failures++
    } else {
      console.log(`  ✓ ${bin.padEnd(30)} ${out}`)
    }
  }

  console.log("\n[verify] per-service smoke tests:")
  for (const [cmd, args] of SMOKES) {
    const r = await sandbox.runCommand(cmd, args)
    const out = (await r.stdout()).trim() || (await r.stderr()).trim()
    if (r.exitCode !== 0) {
      console.error(`  ✗ ${cmd} ${args.join(" ")} — exit ${r.exitCode}: ${out.slice(0, 200)}`)
      failures++
    } else {
      const first = out.split("\n")[0]
      console.log(`  ✓ ${cmd.padEnd(30)} ${first.slice(0, 80)}`)
    }
  }

  console.log("\n[verify] checking workspace root writable:")
  const r = await sandbox.runCommand("sh", [
    "-c",
    "mkdir -p /vercel/sandbox && echo ok > /vercel/sandbox/.verify-probe && rm /vercel/sandbox/.verify-probe && echo OK",
  ])
  const out = (await r.stdout()).trim()
  if (r.exitCode !== 0 || out !== "OK") {
    console.error(`  ✗ /vercel/sandbox not usable — exit ${r.exitCode}: ${out}`)
    failures++
  } else {
    console.log("  ✓ /vercel/sandbox writable")
  }
} catch (err) {
  console.error("\n[verify] FAILED:", err)
  failures++
} finally {
  if (sandbox) {
    try {
      await sandbox.stop()
    } catch {}
  }
}

if (failures > 0) {
  console.error(`\n[verify] image verification FAILED (${failures} issue${failures === 1 ? "" : "s"})`)
  process.exit(1)
}
console.log("\n[verify] image verification OK")
