import { mkdir } from "node:fs/promises"
import { dirname, isAbsolute } from "node:path"
import {
  ConfigParseError,
  mutateConfig,
  readConfig,
  resolveGlobalConfig,
  resolveProjectConfig,
  type ConfigTarget,
  type PluginEntry,
} from "./plugin-config"
import { getStore } from "./store"
import { createCatalogFetcher } from "./plugin-catalog"

// Shared type contracts live in @opencode-ai/app so the renderer and main
// process import the exact same shapes (precedent: desktop-menu, wsl/types).
import type {
  CatalogResult,
  PluginConfigsPayload,
  PluginEntry as PluginEntryContract,
  RecentlyRemoved,
} from "@opencode-ai/app/components/settings-v2/plugins-types"
export type {
  CatalogEntry,
  CatalogResult,
  PluginConfigsPayload,
  PluginEntry,
  RecentlyRemoved,
} from "@opencode-ai/app/components/settings-v2/plugins-types"

const PLUGIN_STORE = "plugin-manager"
const RECENTLY_REMOVED_KEY = "recently-removed"

// Minimal string-keyed store contract so tests can inject an in-memory store
// (electron-store requires the Electron runtime and crashes under plain bun test).
export type PluginStore = {
  get(key: string): string | undefined
  set(key: string, value: string): void
}

export type InstallScope = "global" | "project"

function isInstallScope(scope: unknown): scope is InstallScope {
  return scope === "global" || scope === "project"
}

// IPC args arrive untyped from the renderer; validate shapes at the module
// boundary (precedent: wsl/servers validates identifiers at this layer).
function assertInstallScope(scope: unknown): asserts scope is InstallScope {
  if (!isInstallScope(scope)) throw new Error(`Invalid plugin scope: ${String(scope)}`)
}

// Accepts a bare name ("plugin") or tuple form (["plugin", { options }]);
// anything else is rejected before it can reach the config file.
function parsePluginEntryArg(entry: unknown): PluginEntry | undefined {
  if (entry === undefined) return undefined
  if (typeof entry === "string") {
    if (entry.trim() === "") throw new Error("Invalid plugin entry: name must be non-empty")
    return entry
  }
  if (Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === "string" && entry[0].trim() !== "") {
    const options = entry[1]
    if (options !== null && typeof options === "object" && !Array.isArray(options)) {
      return [entry[0], options as Record<string, unknown>]
    }
    throw new Error("Invalid plugin entry: options must be an object")
  }
  throw new Error("Invalid plugin entry: expected a string or [name, options] tuple")
}

// Project dirs are absolute workspace paths, so validate shape rather than
// location; in particular reject path-traversal-looking values ("..").
function assertProjectDir(projectDir: unknown): asserts projectDir is string {
  if (typeof projectDir !== "string" || projectDir.trim() === "") {
    throw new Error("Project directory is required for project-scoped install")
  }
  if (!isAbsolute(projectDir)) throw new Error(`Invalid project directory: ${projectDir}`)
  if (projectDir.split(/[\\/]+/).includes("..")) {
    throw new Error(`Invalid project directory: ${projectDir}`)
  }
}

function targetFor(scope: InstallScope, projectDir?: string): ConfigTarget {
  if (scope === "global") return resolveGlobalConfig()
  if (!projectDir) throw new Error("Project directory is required for project-scoped install")
  return resolveProjectConfig(projectDir)
}

export function registerPluginManager(
  handlers: { handle: (channel: string, fn: (...args: any[]) => any) => void },
  opts: { userDataDir: string; catalog?: CatalogResult; store?: PluginStore },
) {
  const catalogFetcher = createCatalogFetcher({ cacheDir: opts.userDataDir })
  // Lazy accessor: getStore must not run at module/registration time outside
  // Electron (electron-store touches electron.app.getPath). Tests inject a
  // stub; production resolves the real store on first use.
  const getPluginStore = () => opts.store ?? getStore(PLUGIN_STORE)

  const readRecentlyRemoved = (): RecentlyRemoved[] => {
    try {
      const raw = getPluginStore().get(RECENTLY_REMOVED_KEY)
      if (!raw) return []
      return JSON.parse(String(raw)) as RecentlyRemoved[]
    } catch {
      return []
    }
  }

  const writeRecentlyRemoved = (list: RecentlyRemoved[]) => {
    getPluginStore().set(RECENTLY_REMOVED_KEY, JSON.stringify(list))
  }

  handlers.handle("plugins:fetch-catalog", async () => {
    if (opts.catalog) return opts.catalog // test override
    return await catalogFetcher.fetchCatalog()
  })

  handlers.handle("plugins:read-configs", async (_event: unknown, projectDir?: string) => {
    if (projectDir !== undefined) {
      assertProjectDir(projectDir)
    }
    // Parse failures are returned as structured `errors` entries (scope, path,
    // message) instead of swallowed, so the renderer can surface
    // settings.plugins.errors.parseFailed with the file path and an
    // Open-config action. Other read failures (e.g. missing file) read as
    // empty. The parse error message carries the path (ConfigParseError).
    const errors: NonNullable<PluginConfigsPayload["errors"]> = []
    const readScope = async (target: ConfigTarget, scope: "global" | "project") => {
      try {
        return await readConfig(target)
      } catch (error) {
        if (error instanceof ConfigParseError) {
          errors.push({ scope, path: target.path, message: error.message })
          return { plugins: [], raw: "", data: {}, mtimeMs: 0 }
        }
        throw error
      }
    }
    const globalTarget = resolveGlobalConfig()
    const global = await readScope(globalTarget, "global")
    let projectConfig: Awaited<ReturnType<typeof readConfig>> = { plugins: [], raw: "", data: {}, mtimeMs: 0 }
    let projectPath: string | null = null
    if (projectDir) {
      const target = resolveProjectConfig(projectDir)
      projectPath = target.path
      projectConfig = await readScope(target, "project")
    }
    const removed = readRecentlyRemoved()
    const payload: PluginConfigsPayload = {
      global: global.plugins,
      project: projectConfig.plugins,
      recentlyRemoved: removed,
      paths: {
        // Report the exact file each scope resolves to (jsonc-aware), not a
        // hardcoded .json guess — mirrors what readConfig/mutateConfig target.
        global: globalTarget.path,
        project: projectPath,
      },
      ...(errors.length > 0 ? { errors } : {}),
    }
    return payload
  })

  handlers.handle(
    "plugins:install",
    async (_event: unknown, name: string, entry: PluginEntryContract | undefined, scope: InstallScope, projectDir?: string) => {
      if (typeof name !== "string" || name.trim() === "") throw new Error("Invalid plugin name")
      assertInstallScope(scope)
      if (scope === "project") assertProjectDir(projectDir)
      const parsedEntry = parsePluginEntryArg(entry)
      const target = targetFor(scope, projectDir)
      // First install on a fresh machine has no config dir yet; the atomic
      // tmpfile+rename write strategy requires the parent directory to exist.
      await mkdir(dirname(target.path), { recursive: true })
      await mutateConfig(target, { kind: "add", name, ...(parsedEntry ? { entry: parsedEntry } : {}) })
      // Drop from recently-removed on (re)install
      const removed = readRecentlyRemoved()
      const next = removed.filter((r) => !(r.name === name && r.scope === scope))
      if (next.length !== removed.length) writeRecentlyRemoved(next)
      return { ok: true as const }
    },
  )

  handlers.handle(
    "plugins:remove",
    async (_event: unknown, name: string, scope: InstallScope, remember: boolean, projectDir?: string) => {
      if (typeof name !== "string" || name.trim() === "") throw new Error("Invalid plugin name")
      assertInstallScope(scope)
      if (scope === "project") assertProjectDir(projectDir)
      const target = targetFor(scope, projectDir)
      const before = await readConfig(target)
      const existing = before.plugins.find((e) => (typeof e === "string" ? e : e[0]) === name)
      await mutateConfig(target, { kind: "remove", name })
      if (remember && existing) {
        const removed = readRecentlyRemoved()
        removed.push({ name, entry: existing, scope, removedAt: Date.now() })
        writeRecentlyRemoved(removed)
      }
      return { ok: true as const }
    },
  )
}

// Exposed for the renderer "open config" action; mirrors resolveGlobalConfig
// (XDG_CONFIG_HOME when set, else ~/.config) including the jsonc sibling.
export const globalConfigPath = () => resolveGlobalConfig().path
