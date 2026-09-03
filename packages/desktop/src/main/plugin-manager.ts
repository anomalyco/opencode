import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import {
  mutateConfig,
  readConfig,
  resolveGlobalConfig,
  resolveProjectConfig,
  type ConfigTarget,
} from "./plugin-config"
import { getStore } from "./store"
import { createCatalogFetcher } from "./plugin-catalog"

// Shared type contracts live in @opencode-ai/app so the renderer and main
// process import the exact same shapes (precedent: desktop-menu, wsl/types).
import type {
  CatalogResult,
  PluginConfigsPayload,
  PluginEntry,
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

export type RecentlyRemovedRecord = RecentlyRemoved

export type InstallScope = "global" | "project"

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
    const globalTarget = resolveGlobalConfig()
    const global = await readConfig(globalTarget).catch(() => ({ plugins: [], raw: "", data: {}, mtimeMs: 0 }))
    const projectConfig = projectDir
      ? await readConfig(resolveProjectConfig(projectDir)).catch(() => ({ plugins: [], raw: "", data: {}, mtimeMs: 0 }))
      : { plugins: [], raw: "", data: {}, mtimeMs: 0 }
    const removed = readRecentlyRemoved()
    return {
      global: global.plugins,
      project: projectConfig.plugins,
      recentlyRemoved: removed,
      paths: {
        global: globalTarget.path,
        project: projectDir ? join(projectDir, "opencode.json") : null,
      },
    }
  })

  handlers.handle(
    "plugins:install",
    async (_event: unknown, name: string, entry: PluginEntry | undefined, scope: InstallScope, projectDir?: string) => {
      if (typeof name !== "string" || name.length === 0) throw new Error("Invalid plugin name")
      const target = targetFor(scope, projectDir)
      // First install on a fresh machine has no config dir yet; the atomic
      // tmpfile+rename write strategy requires the parent directory to exist.
      await mkdir(dirname(target.path), { recursive: true })
      await mutateConfig(target, { kind: "add", name, ...(entry ? { entry } : {}) })
      // Drop from recently-removed on (re)install
      const removed = readRecentlyRemoved()
      const next = removed.filter((r) => !(r.name === name && r.scope === scope))
      if (next.length !== removed.length) writeRecentlyRemoved(next)
      return { ok: true }
    },
  )

  handlers.handle(
    "plugins:remove",
    async (_event: unknown, name: string, scope: InstallScope, remember: boolean, projectDir?: string) => {
      const target = targetFor(scope, projectDir)
      const before = await readConfig(target)
      const existing = before.plugins.find((e) => (typeof e === "string" ? e : e[0]) === name)
      await mutateConfig(target, { kind: "remove", name })
      if (remember && existing) {
        const removed = readRecentlyRemoved()
        removed.push({ name, entry: existing, scope, removedAt: Date.now() })
        writeRecentlyRemoved(removed)
      }
      return { ok: true }
    },
  )
}

// Global config path helper used by renderer "open config" action
export const globalConfigPath = () => join(homedir(), ".config", "opencode", "opencode.json")