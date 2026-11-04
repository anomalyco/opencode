export * as ConfigDiscovery from "./discovery.js"

import os from "os"
import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Location } from "../location.js"
import { AbsolutePath } from "../schema.js"
import type { Options } from "../config.js"

export const names = ["opencode.json", "opencode.jsonc"]

/** Eligible sources in priority order, including paths that may appear later. */
export interface Sources {
  readonly system?: { readonly path: AbsolutePath; readonly present: boolean }
  /** macOS MDM managed preferences plist (`ai.opencode.managed`), when one is deployed. */
  readonly preferences?: AbsolutePath
  readonly global?: AbsolutePath
  readonly explicit?: AbsolutePath
  readonly direct: readonly AbsolutePath[]
  readonly project: readonly { readonly path: AbsolutePath; readonly present: boolean }[]
  readonly claude: readonly AbsolutePath[]
  readonly agents: readonly AbsolutePath[]
}

/** Platform system configuration directory (`/Library/Application Support/opencode`, `/etc/opencode`, `%ProgramData%\opencode`). */
export function systemDirectory(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env) {
  if (platform === "darwin") return AbsolutePath.make("/Library/Application Support/opencode")
  if (platform === "win32") return AbsolutePath.make(path.join(env.ProgramData || "C:\\ProgramData", "opencode"))
  return AbsolutePath.make("/etc/opencode")
}

/** macOS MDM managed preferences plists, most specific first; the first one present wins. */
export function preferencePaths(user: string) {
  return [
    AbsolutePath.make(path.join("/Library/Managed Preferences", user, "ai.opencode.managed.plist")),
    AbsolutePath.make("/Library/Managed Preferences/ai.opencode.managed.plist"),
  ]
}

// Keys macOS and MDM profiles inject into managed preferences that are not OpenCode config.
const preferenceMetadata = new Set([
  "PayloadDisplayName",
  "PayloadIdentifier",
  "PayloadType",
  "PayloadUUID",
  "PayloadVersion",
  "_manualProfile",
])

/** Removes MDM payload metadata from `plutil -convert json` output. */
export function stripPreferenceMetadata(json: string) {
  const parsed: unknown = JSON.parse(json)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json
  return JSON.stringify(Object.fromEntries(Object.entries(parsed).filter(([key]) => !preferenceMetadata.has(key))))
}

export const discover = Effect.fn("ConfigDiscovery.discover")(function* (options?: Options) {
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const location = yield* Location.Service
  const system = (() => {
    if (options?.system === false) return
    if (typeof options?.system === "string") return AbsolutePath.make(path.resolve(options.system))
    return systemDirectory()
  })()
  const globalDirectory = AbsolutePath.make(global.config)
  const globalAgentsDirectory = AbsolutePath.make(path.join(global.home, ".agents"))
  const globalClaudeDirectory = AbsolutePath.make(path.join(global.home, ".claude"))
  const configDirectories = [...(system ? [system] : []), globalDirectory]
  const globalRoots = yield* Effect.forEach(
    [...configDirectories, globalClaudeDirectory, globalAgentsDirectory],
    (item) => fs.resolve(item),
    { concurrency: "unbounded" },
  )
  const current = yield* fs.resolve(location.directory)
  const directories =
    globalRoots.slice(0, configDirectories.length).includes(current) || options?.project === false
      ? []
      : yield* fs.up({ targets: ["."], start: location.directory }).pipe(Effect.orDie)
  const candidates = [".claude", ".agents", ".opencode", ...names.toReversed()]
  const discovered = yield* Effect.forEach(
    directories,
    (directory) =>
      Effect.gen(function* () {
        // Resolve the parent too: missing children must honor symlinked global roots.
        const parent = directory === location.directory ? current : yield* fs.resolve(directory)
        // One directory listing skips realpath and stat on absent candidates; sandboxes that deny
        // listing an ancestor fall back to probing each candidate directly.
        const entries = yield* fs.readDirectory(parent).pipe(
          Effect.map((list) => new Set(list.map((entry) => entry.toLowerCase()))),
          Effect.orElseSucceed(() => undefined),
        )
        return yield* Effect.forEach(
          candidates,
          (name) => {
            const item = AbsolutePath.make(path.join(directory, name))
            if (entries && !entries.has(name.toLowerCase())) {
              return Effect.succeed({ item, resolved: path.resolve(parent, name), missing: true })
            }
            return fs
              .resolve(path.join(parent, name))
              .pipe(Effect.map((resolved) => ({ item, resolved, missing: false })))
          },
          { concurrency: "unbounded" },
        )
      }),
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map((items) => items.flat()),
    Effect.orDie,
  )

  const globalEnabled = options?.global !== false
  const globalFiles = yield* Effect.forEach(
    configDirectories.flatMap((directory) => names.map((name) => path.join(directory, name))),
    (file) => fs.resolve(file),
    { concurrency: "unbounded" },
  )
  // Global sources must not re-enter through the project walk.
  const visibleEntries = discovered.filter((entry) =>
    globalEnabled
      ? !globalRoots.includes(entry.resolved) && !globalFiles.includes(entry.resolved)
      : !globalRoots.some((root) => entry.resolved === root || entry.resolved.startsWith(root + path.sep)),
  )
  const visible = visibleEntries.map((entry) => entry.item)

  // A custom system directory replaces platform discovery, so it also skips host MDM preferences.
  const preferences =
    globalEnabled && (options?.system ?? true) === true && process.platform === "darwin"
      ? (yield* Effect.filter(
          preferencePaths(yield* Effect.try(() => os.userInfo().username).pipe(Effect.orElseSucceed(() => "user"))),
          fs.isFile,
        )).at(0)
      : undefined

  return {
    system: globalEnabled && system ? { path: system, present: yield* fs.isDir(system) } : undefined,
    preferences,
    global: globalEnabled ? globalDirectory : undefined,
    explicit: options?.file ? AbsolutePath.make(path.resolve(options.file)) : undefined,
    direct: visible.filter((item) => ![".agents", ".claude", ".opencode"].includes(path.basename(item))).toReversed(),
    project: yield* Effect.forEach(
      visibleEntries.filter((entry) => path.basename(entry.item) === ".opencode").toReversed(),
      (entry) =>
        entry.missing
          ? Effect.succeed({ path: entry.item, present: false })
          : fs.isDir(entry.item).pipe(Effect.map((present) => ({ path: entry.item, present }))),
      { concurrency: "unbounded" },
    ),
    claude:
      options?.claude === false
        ? []
        : [
            ...new Set([
              ...(globalEnabled ? [globalClaudeDirectory] : []),
              ...visible.filter((item) => path.basename(item) === ".claude").toReversed(),
            ]),
          ],
    agents: [
      ...new Set([
        ...(globalEnabled ? [globalAgentsDirectory] : []),
        ...visible.filter((item) => path.basename(item) === ".agents").toReversed(),
      ]),
    ],
  } satisfies Sources
})
