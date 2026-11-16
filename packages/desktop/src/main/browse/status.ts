import { execFile } from "node:child_process"
import { stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { Option, Schema } from "effect"
import type { BrowseExtensionState } from "../../shared/ipc-contract"

export type BrowseSetup = {
  readonly installed: boolean
  readonly configured: boolean
  readonly extension: BrowseExtensionState
}

const ABSENT: BrowseSetup = Object.freeze({ installed: false, configured: false, extension: "unknown" })

const EXTENSION_STATES = new Map<string, BrowseExtensionState>(
  (["connected", "paired-offline", "unpaired", "refused", "not-seen", "incompatible"] as const).map((state) => [
    state,
    state,
  ]),
)

// `browse status --json`: the relay's status (absent while it isn't running) plus this install's setup.
const StatusJson = Schema.Struct({
  connected: Schema.optionalKey(Schema.Boolean),
  pairingState: Schema.optionalKey(Schema.String),
  relay: Schema.optionalKey(Schema.Struct({ running: Schema.optionalKey(Schema.Boolean) })),
  setup: Schema.optionalKey(
    Schema.Struct({
      installed: Schema.optionalKey(Schema.Boolean),
      mcp: Schema.optionalKey(Schema.NullOr(Schema.String)),
      agents: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String }))),
    }),
  ),
})

const decodeStatus = Schema.decodeUnknownOption(Schema.fromJsonString(StatusJson))

/**
 * Where a `browse` executable can be, most likely first: the install script's `~/.local/bin` (or `$XDG_BIN_HOME`),
 * bun's global bin, then PATH. A packaged app on macOS starts with a minimal PATH, so the usual locations are listed
 * explicitly.
 */
export function browseBinaries(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv) {
  const join = platform === "win32" ? path.win32.join : path.posix.join
  const isAbsolute = platform === "win32" ? path.win32.isAbsolute : path.posix.isAbsolute
  const name = platform === "win32" ? "browse.exe" : "browse"
  const delimiter = platform === "win32" ? ";" : ":"

  const xdg = env.XDG_BIN_HOME && isAbsolute(env.XDG_BIN_HOME) ? [env.XDG_BIN_HOME] : []

  const known =
    platform === "win32"
      ? [join(env.USERPROFILE || home, ".local", "bin")]
      : [join(home, ".local/bin"), join(home, ".bun/bin"), "/opt/homebrew/bin", "/usr/local/bin"]

  const dirs = [...xdg, ...known, ...(env.PATH ?? "").split(delimiter).filter((dir) => dir && isAbsolute(dir))]

  return [...new Set(dirs.map((dir) => join(dir, name)))]
}

/** Reads `browse status --json`. A relay that isn't running reports no extension state: agents start it on demand. */
export function parseBrowseStatus(stdout: string): BrowseSetup {
  const status = Option.getOrUndefined(decodeStatus(stdout))

  if (!status) return ABSENT

  const configured = !!status.setup?.mcp || !!status.setup?.agents?.some((agent) => agent.name === "opencode")

  return { installed: status.setup?.installed === true, configured, extension: extension(status) }
}

function extension(status: typeof StatusJson.Type): BrowseExtensionState {
  if (status.relay?.running === false) return "unknown"

  if (status.connected) return "connected"

  return EXTENSION_STATES.get(status.pairingState ?? "") ?? "unknown"
}

const STATUS_TIMEOUT_MS = 15_000

export async function readBrowseSetup(binaries: readonly string[]): Promise<BrowseSetup> {
  for (const binary of binaries) {
    const info = await stat(binary).catch(() => undefined)

    if (!info?.isFile()) continue

    const output = await promisify(execFile)(binary, ["status", "--json"], {
      timeout: STATUS_TIMEOUT_MS,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: "1" },
    }).catch(() => undefined)

    // A browse that can't answer is treated as missing, so installing again repairs it.
    return output ? parseBrowseStatus(output.stdout) : ABSENT
  }

  return ABSENT
}
