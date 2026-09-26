export * as ConfigManaged from "./managed.js"

import os from "os"
import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { names } from "./discovery.js"

const DOMAIN = "ai.opencode.managed"

// Keys macOS/MDM injects into the managed payload that are not OpenCode config.
const PLIST_META = new Set([
  "PayloadDisplayName",
  "PayloadIdentifier",
  "PayloadType",
  "PayloadUUID",
  "PayloadVersion",
  "_manualProfile",
])

export interface Paths {
  /** Admin-owned directory holding `opencode.json(c)`; omitted disables it. */
  readonly directory?: string
  /** macOS managed-preference plists in lookup order; the first readable one wins. */
  readonly preferences?: readonly string[]
}

export interface Source {
  readonly path: string
  readonly text: string
}

/** Where administrators deploy managed configuration on the current platform. */
export function systemPaths(platform: NodeJS.Platform = process.platform, username = currentUser()): Paths {
  if (platform === "darwin")
    return {
      directory: "/Library/Application Support/opencode",
      preferences: [
        path.join("/Library/Managed Preferences", username, `${DOMAIN}.plist`),
        path.join("/Library/Managed Preferences", `${DOMAIN}.plist`),
      ],
    }
  if (platform === "win32") return { directory: path.join(process.env.ProgramData || "C:\\ProgramData", "opencode") }
  return { directory: "/etc/opencode" }
}

/** Every path a managed source can be read from. */
export function candidates(paths: Paths): string[] {
  return [...directoryFiles(paths), ...(paths.preferences ?? [])]
}

function directoryFiles(paths: Paths) {
  const directory = paths.directory
  return directory ? names.map((name) => path.join(directory, name)) : []
}

/** Converts `plutil -convert json` output into config JSON by dropping MDM metadata keys. */
export function parsePlist(json: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(json)
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error("managed plist root is not a dictionary")
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !PLIST_META.has(key)))
}

/** Reads managed sources from lowest to highest priority: directory files, then the first readable plist. */
export const sources = Effect.fn("ConfigManaged.sources")(function* (paths: Paths) {
  const fs = yield* FSUtil.Service
  const result: Source[] = []
  for (const file of directoryFiles(paths)) {
    const text = yield* fs
      .readFileStringSafe(file)
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("failed to read managed config", { source: file, error }).pipe(Effect.as(undefined)),
        ),
      )
    if (text !== undefined) result.push({ path: file, text })
  }
  for (const plist of paths.preferences ?? []) {
    if (!(yield* fs.isFile(plist))) continue
    const text = yield* Effect.tryPromise(() => convertPlist(plist)).pipe(
      Effect.catch((error) =>
        Effect.logWarning("failed to read managed preferences", { source: plist, error }).pipe(Effect.as(undefined)),
      ),
    )
    if (text === undefined) continue
    result.push({ path: plist, text })
    break
  }
  return result
})

async function convertPlist(plist: string) {
  // Imported lazily: only macOS hosts with a deployed profile ever spawn plutil.
  const { execFile } = await import("node:child_process")
  const { promisify } = await import("node:util")
  const { stdout } = await promisify(execFile)("plutil", ["-convert", "json", "-o", "-", plist])
  return JSON.stringify(parsePlist(stdout))
}

function currentUser() {
  try {
    return os.userInfo().username || "user"
  } catch {
    return "user"
  }
}
