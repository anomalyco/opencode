#!/usr/bin/env bun
// Builds the snapshot that VercelBackend uses as its `source`. The image
// contains every tool the L4 services need (git, rg, prettier, gofmt,
// rustfmt, black, shfmt, 4 language servers, node/npm, python3, go,
// coreutils) plus the exec-channel gateway daemon pre-installed.
//
// Layered rebuild on top of a previous snapshot — cuts build time from
// ~15m to ~4m. Drop `baseSnapshotId` for a clean-slate rebuild.
//
// Prints `SNAPSHOT_ID=<id>` on completion; a shell wrapper parses this
// into VERCEL_SANDBOX_IMAGE_ID.

import { Sandbox } from "@vercel/sandbox"
import { readFileSync } from "node:fs"
import path from "node:path"

// The gateway ships as a small npm package next to this build script.
// package.json declares `bin: { "opencode-gateway": "./gateway.js" }`
// and a runtime dependency on `ws@8`. Installing it with `npm
// install -g` places the bin on the sandbox PATH (alongside the
// other globally-installed tools like typescript-language-server)
// and resolves `ws` via standard node module lookup — no NODE_PATH
// hacks and no client-side knowledge of where anything lives.
const GATEWAY_DIR = path.join(import.meta.dir, "gateway")
const GATEWAY_SOURCES: Record<string, string> = {
  "package.json": readFileSync(path.join(GATEWAY_DIR, "package.json"), "utf8"),
  "gateway.js": readFileSync(path.join(GATEWAY_DIR, "gateway.js"), "utf8"),
}

// The name of the bin exposed by the gateway package. After
// `npm install -g` it's on PATH; the client just runs it by name.
const GATEWAY_BIN = "opencode-gateway"

const token = process.env["VERCEL_TOKEN"]
const teamId = process.env["VERCEL_TEAM_ID"]
const projectId = process.env["VERCEL_PROJECT_ID"]
const baseSnapshotId = process.env["VERCEL_SANDBOX_IMAGE_ID"]

if (!token || !teamId || !projectId) {
  console.error("missing VERCEL_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID")
  process.exit(2)
}

const START = Date.now()
const elapsed = () => `${((Date.now() - START) / 1000).toFixed(1)}s`
const log = (step: string, msg: string) => console.log(`[build] ${elapsed()} ${step}: ${msg}`)

const sh = async (
  sb: Sandbox,
  script: string,
  label: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  log(label, script.length > 90 ? script.slice(0, 90) + "..." : script)
  const res = await sb.runCommand("bash", ["-lc", script])
  const [stdout, stderr] = await Promise.all([res.stdout(), res.stderr()])
  if (res.exitCode !== 0) {
    console.error(`[build]   FAIL (exit ${res.exitCode}): ${label}`)
    if (stdout.trim()) {
      console.error(`  --- stdout ---\n${stdout.trim().slice(-4000)}`)
    }
    if (stderr.trim()) {
      console.error(`  --- stderr ---\n${stderr.trim().slice(-4000)}`)
    }
    throw new Error(`${label} failed`)
  }
  return { exitCode: res.exitCode ?? 0, stdout, stderr }
}

const REQUIRED_TOOLS = [
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
  "node",
  "npm",
  "python3",
  "go",
]

let sandbox: Sandbox | null = null

try {
  log("create", `creating sandbox from base ${baseSnapshotId ?? "(no base)"}`)
  const createParams: Parameters<typeof Sandbox.create>[0] = {
    token,
    teamId,
    projectId,
    timeout: 30 * 60 * 1000,
  } as Parameters<typeof Sandbox.create>[0]
  if (baseSnapshotId) {
    ;(createParams as any).source = { type: "snapshot", snapshotId: baseSnapshotId }
  }
  sandbox = await Sandbox.create(createParams)
  log("create", `sandbox ${sandbox.name} ready`)

  // ---- typescript-language-server (+ typescript) ----
  //
  // `sudo` isn't reliably present in every base image; npm install -g
  // lands under /vercel/runtimes/node24/ which the vercel user owns
  // so sudo isn't needed.
  await sh(
    sandbox,
    "npm install -g --no-audit --no-fund typescript typescript-language-server",
    "install typescript-language-server",
  )

  // ---- pyright ----
  await sh(
    sandbox,
    "npm install -g --no-audit --no-fund pyright",
    "install pyright",
  )

  // ---- gopls ----
  //
  // `go install` drops the binary under $GOBIN. Compiling gopls is
  // memory-hungry; the vercel sandbox's default resources run out of
  // RAM on parallel compilation → silent kill + exit 1. GOMAXPROCS=1
  // serializes the compile, and GOMEMLIMIT caps the heap so the Go
  // runtime runs GC more aggressively. Using gopls@latest so the
  // transitive golang.org/x/tools matches the sandbox's Go 1.25
  // compiler (older gopls pins break on `tokeninternal.go` compile-
  // time assertions).
  //
  // /usr/local/bin is read-only for the vercel user in this image —
  // use /vercel/runtimes/node24/bin which npm install -g already
  // writes to, meaning it's writable and on $PATH.
  await sh(
    sandbox,
    `set -euo pipefail
export GOPATH=/tmp/go
export GOBIN=/tmp/go/bin
export PATH="/tmp/go/bin:$PATH"
export GOMAXPROCS=1
export GOMEMLIMIT=900MiB
mkdir -p /tmp/go/bin
go install golang.org/x/tools/gopls@latest 2>&1 | tail -100
install -m 755 /tmp/go/bin/gopls /vercel/runtimes/node24/bin/gopls
gopls version`,
    "install gopls",
  )

  // ---- rust-analyzer ----
  //
  // Pre-built release tarball from GitHub, no cargo build required.
  await sh(
    sandbox,
    `set -euo pipefail
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  TRIPLE="x86_64-unknown-linux-gnu" ;;
  aarch64) TRIPLE="aarch64-unknown-linux-gnu" ;;
  *) echo "unsupported $ARCH" >&2; exit 1 ;;
esac
URL="https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-\${TRIPLE}.gz"
curl -fsSL "$URL" -o /tmp/rust-analyzer.gz
gunzip -f /tmp/rust-analyzer.gz
install -m 755 /tmp/rust-analyzer /vercel/runtimes/node24/bin/rust-analyzer
rm -f /tmp/rust-analyzer.gz
rust-analyzer --version`,
    "install rust-analyzer",
  )

  // ---- exec-channel gateway daemon ----
  //
  // Bake the gateway into the image so VercelBackend doesn't upload
  // anything on cold start. Flow:
  //   1. writeFiles the gateway package (package.json + gateway.js)
  //      into /tmp/opencode-gateway/ — /tmp is always user-writable.
  //   2. `npm install -g /tmp/opencode-gateway` — installs the bin
  //      under npm's global prefix so `opencode-gateway` becomes a
  //      PATH command, and pulls `ws@8` into the package's own
  //      node_modules so require("ws") resolves via standard node
  //      module lookup from the gateway's __dirname.
  log("gateway", "installing gateway package globally")
  await sandbox.writeFiles(
    Object.entries(GATEWAY_SOURCES).map(([name, content]) => ({
      path: `/tmp/opencode-gateway/${name}`,
      content: Buffer.from(content),
    })),
  )
  // `npm install -g <dir>` packs the directory first, which drops
  // node_modules. We pack explicitly to a tarball and install from
  // that — npm then resolves the package's `dependencies` against
  // the global npm cache and installs `ws` into the proper place
  // so the gateway's `require("ws")` works at runtime.
  await sh(
    sandbox,
    [
      "set -euo pipefail",
      "cd /tmp/opencode-gateway",
      // pack produces opencode-gateway-0.0.0.tgz in cwd
      "npm pack --silent",
      "TGZ=$(ls opencode-gateway-*.tgz | head -1)",
      "npm install -g --no-audit --no-fund ./${TGZ}",
    ].join("\n"),
    "pack + install opencode-gateway",
  )
  // Verify the gateway binary exists and can actually load ws from
  // its own node_modules (not just "is on PATH").
  await sh(
    sandbox,
    [
      "set -euo pipefail",
      `GW_BIN=$(command -v ${GATEWAY_BIN})`,
      `test -n "$GW_BIN"`,
      // Resolve the realpath of the bin so we find the installed
      // package root, then assert ws is reachable from there.
      `GW_REAL=$(readlink -f "$GW_BIN")`,
      `GW_PKG_DIR=$(dirname "$GW_REAL")`,
      `test -d "$GW_PKG_DIR/node_modules/ws" || test -d "$GW_PKG_DIR/../node_modules/ws"`,
      `echo gateway-ready`,
    ].join("\n"),
    "verify opencode-gateway deps",
  )

  // ---- sanity check every required tool ----
  log("verify", "checking every required binary is on PATH")
  for (const bin of REQUIRED_TOOLS) {
    const r = await sandbox.runCommand("sh", ["-c", `command -v ${bin}`])
    if (r.exitCode !== 0) {
      throw new Error(`sanity check failed: ${bin} not on PATH`)
    }
    const out = (await r.stdout()).trim()
    console.log(`[build] ${elapsed()}   ${bin.padEnd(30)} -> ${out}`)
  }

  // ---- sanity check gateway ----
  log("verify", `checking ${GATEWAY_BIN} is on PATH`)
  const gwCheck = await sandbox.runCommand("sh", ["-c", `command -v ${GATEWAY_BIN}`])
  if (gwCheck.exitCode !== 0) {
    throw new Error(`gateway sanity check failed — ${GATEWAY_BIN} not on PATH`)
  }
  const gwPath = (await gwCheck.stdout()).trim()
  console.log(`[build] ${elapsed()}   ${GATEWAY_BIN.padEnd(30)} -> ${gwPath}`)

  // ---- snapshot ----
  log("snapshot", "creating snapshot (no expiration)...")
  const snap = (await (sandbox as any).snapshot({ expiration: 0 })) as {
    snapshotId: string
  }
  log("snapshot", `done: ${snap.snapshotId}`)
  console.log(`\nSNAPSHOT_ID=${snap.snapshotId}`)
} catch (err) {
  console.error("[build] FAILED:", err)
  process.exitCode = 1
} finally {
  if (sandbox) {
    log("cleanup", "stopping sandbox...")
    try {
      await sandbox.stop()
    } catch (e) {
      console.error("[build] cleanup stop failed:", e)
    }
  }
}
