#!/usr/bin/env bun

import { dirname } from "node:path"
import { runOpencode } from "./opencode"
import { startSidecar, watchSidecar } from "./sidecar"
import { requireXaiApiKey } from "./xai"

const HELP = `voxcode — OpenCode with voice (local)

Usage:
  voxcode [project]           start terminal UI with voice
  voxcode tui [project]       terminal UI — press F3 for voice mode
  voxcode web [flags]         start web UI with voice
  voxcode <opencode cmd> …    pass through to opencode (no voice)

Environment:
  XAI_API_KEY          required for voice (https://console.x.ai)
  VOXCODE_VOICE_PORT   voice sidecar port (default 8765)
  VOXCODE_OPENCODE_BIN path to opencode binary (optional)
  VOXCODE_SIDECAR_ROOT path to packages/voice-sidecar (optional)
  VOXCODE_PYTHON       python executable (default python3)
`

const OPENCODE_COMMANDS = new Set([
  "acp",
  "mcp",
  "attach",
  "run",
  "generate",
  "debug",
  "account",
  "console",
  "providers",
  "agent",
  "upgrade",
  "uninstall",
  "serve",
  "models",
  "stats",
  "export",
  "import",
  "github",
  "pr",
  "session",
  "plug",
  "db",
  "completion",
  "help",
])

function voiceMode(args: string[]) {
  if (args.length === 0) return { mode: "tui" as const, opencodeArgs: [] as string[] }
  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") return { mode: "help" as const, opencodeArgs: [] }
  if (args[0] === "web") return { mode: "web" as const, opencodeArgs: args.slice(1) }
  if (args[0] === "tui") return { mode: "tui" as const, opencodeArgs: args.slice(1) }
  if (args[0] === "version" || args[0] === "--version" || args[0] === "-v") {
    return { mode: "passthrough" as const, opencodeArgs: ["--version"] }
  }
  if (args[0] !== undefined && OPENCODE_COMMANDS.has(args[0])) return { mode: "passthrough" as const, opencodeArgs: args }
  return { mode: "tui" as const, opencodeArgs: args }
}

async function main() {
  const args = process.argv.slice(2)
  const parsed = voiceMode(args)

  if (parsed.mode === "help") {
    process.stdout.write(HELP)
    process.exit(0)
  }

  if (parsed.mode === "passthrough") {
    process.exit(await runOpencode(process.execPath, parsed.opencodeArgs))
  }

  requireXaiApiKey()

  const exeDir = dirname(process.execPath)
  const { child: sidecar } = await startSidecar(exeDir)

  let stopping = false
  watchSidecar(sidecar, () => {
    if (stopping) return
    stopping = true
    process.stderr.write("voxcode: voice sidecar stopped\n")
    process.exit(1)
  })

  const opencodeArgs = parsed.mode === "web" ? ["web", ...parsed.opencodeArgs] : parsed.opencodeArgs
  const code = await runOpencode(process.execPath, opencodeArgs)

  stopping = true
  sidecar?.kill()
  process.exit(code)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
